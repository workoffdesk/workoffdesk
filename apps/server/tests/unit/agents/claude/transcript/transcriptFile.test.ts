import { appendFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../../../../src/agents/claude/transcript/chat.js';
import { findSubagent, findTranscript, lastSaid, readChat, readChatBefore } from '../../../../../src/agents/claude/transcript/transcriptFile.js';

const at = '2026-10-03T06:00:00.000Z';
const user = (content: unknown, extra = {}) => ({ type: 'user', timestamp: at, message: { role: 'user', content }, ...extra });
const assistant = (block: unknown, extra = {}) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [block] }, ...extra });
const line = (r: unknown) => `${JSON.stringify(r)}\n`;
const scratch = () => mkdtempSync(join(tmpdir(), 'ts-chat-'));

describe('readChat', () => {
  it('reads what was added since the last read, and leaves a line still being written for next time', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, line(user('第一句')) + line(assistant({ type: 'text', text: '收到' })));
    const a = await readChat(f, 0);
    expect(a.items.map((i) => i.k)).toEqual(['user', 'text']);
    expect(a.next).toBe(statSync(f).size);
    expect(a.skipped).toBe(false);

    const half = line(user('第二句'));
    appendFileSync(f, half.slice(0, 10));
    const b = await readChat(f, a.next);
    expect(b).toEqual({ items: [], from: a.next, next: a.next, skipped: false });

    appendFileSync(f, half.slice(10));
    const c = await readChat(f, b.next);
    expect(c.items).toEqual([{ k: 'user', text: '第二句', at }]);
    expect(c.next).toBe(statSync(f).size);
  });

  it('steps over a line that is not JSON', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, `not json\n${line(user('好'))}`);
    expect((await readChat(f, 0)).items).toEqual([{ k: 'user', text: '好', at }]);
  });

  it('reads a big addition in pieces that end on whole lines, without breaking Chinese characters', async () => {
    const f = join(scratch(), 's.jsonl');
    const lines = Array.from({ length: 40 }, (_, i) => line(user(`第${i}句：中文内容中文内容`)));
    writeFileSync(f, lines.join(''));
    const seen: string[] = [];
    let from = 0;
    for (let n = 0; n < 100 && from < statSync(f).size; n++) {
      const r = await readChat(f, from, { maxRead: 300 });
      expect(r.next).toBeGreaterThan(from);
      seen.push(...r.items.map((i) => (i.k === 'user' ? i.text : '')));
      from = r.next;
    }
    expect(seen).toEqual(lines.map((_, i) => `第${i}句：中文内容中文内容`));
  });

  it('opens a long conversation on its last turns, from the start of a line, and says older turns were left out', async () => {
    const f = join(scratch(), 's.jsonl');
    const lines = Array.from({ length: 200 }, (_, i) => line(user(`句${i}：中文`)));
    writeFileSync(f, lines.join(''));
    const r = await readChat(f, 0, { turns: 30 });
    expect(r.items.map((i) => (i.k === 'user' ? i.text : ''))).toEqual(lines.slice(170).map((_, i) => `句${170 + i}：中文`));
    expect(r.from).toBe(Buffer.byteLength(lines.slice(0, 170).join('')));
    expect(r.next).toBe(statSync(f).size);
    expect(r.skipped).toBe(true);
  });

  it('opens a short conversation whole', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, line(user('一')) + line(assistant({ type: 'text', text: '二' })));
    expect(await readChat(f, 0, { turns: 30 })).toMatchObject({ from: 0, next: statSync(f).size, skipped: false });
  });

  it('starts over, and says so, when the file is shorter than where the last read stopped', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, line(user('新的')));
    const r = await readChat(f, 10_000);
    expect(r.items).toEqual([{ k: 'user', text: '新的', at }]);
    expect(r.from).toBe(0);
  });
});

describe('readChatBefore', () => {
  const said = (items: ChatItem[]) => items.map((i) => (i.k === 'user' || i.k === 'text' ? i.text : `<${i.k}>`));

  it('pages back from where the copy the caller has starts, in pieces that join up with nothing lost or repeated', async () => {
    const f = join(scratch(), 's.jsonl');
    const lines = Array.from({ length: 95 }, (_, i) => line(user(`第${i}句：中文内容`)));
    writeFileSync(f, lines.join(''));
    const first = await readChat(f, 0, { turns: 20 });
    expect(first.items).toHaveLength(20);
    const seen = said(first.items);
    let before = first.from;
    let pages = 0;
    for (let n = 0; n < 20 && before > 0; n++, pages++) {
      const r = await readChatBefore(f, before, { turns: 20, chunk: 64 });
      expect(r.next).toBe(before);
      expect(r.items.length).toBeLessThanOrEqual(20);
      seen.unshift(...said(r.items));
      before = r.from;
    }
    expect(before).toBe(0);
    expect(pages).toBe(4);
    expect(seen).toEqual(lines.map((_, i) => `第${i}句：中文内容`));
  });

  it('counts turns, not the tool output that goes with them', async () => {
    const f = join(scratch(), 's.jsonl');
    const rounds = Array.from({ length: 10 }, (_, i) =>
      line(assistant({ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `ls ${i}` } })) +
      line(user([{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }])),
    );
    writeFileSync(f, rounds.join(''));
    const r = await readChatBefore(f, statSync(f).size, { turns: 3 });
    expect(said(r.items)).toEqual(['<tool>', '<result>', '<tool>', '<result>', '<tool>', '<result>']);
  });

  it('leaves out a line still being written at the end, to be read when it is whole', async () => {
    const f = join(scratch(), 's.jsonl');
    const whole = line(user('写完的'));
    writeFileSync(f, whole + line(user('写到一半')).slice(0, 12));
    const r = await readChatBefore(f, Number.MAX_SAFE_INTEGER, { turns: 5 });
    expect(said(r.items)).toEqual(['写完的']);
    expect(r).toMatchObject({ from: 0, next: Buffer.byteLength(whole) });
  });

  it('stops at its read budget when the turns are far apart, still a step further back each time', async () => {
    const f = join(scratch(), 's.jsonl');
    const noise = line({ type: 'attachment', attachment: { content: 'x'.repeat(1000) } });
    writeFileSync(f, line(user('很早的')) + noise.repeat(8) + line(user('最近的')));
    const recent = await readChatBefore(f, statSync(f).size, { turns: 5, maxRead: 2500, chunk: 512 });
    expect(said(recent.items)).toEqual(['最近的']);
    const seen: string[] = [];
    let before = statSync(f).size;
    for (let n = 0; n < 20 && before > 0; n++) {
      const r = await readChatBefore(f, before, { turns: 5, maxRead: 2500, chunk: 512 });
      expect(r.from).toBeLessThan(before);
      seen.unshift(...said(r.items));
      before = r.from;
    }
    expect(seen).toEqual(['很早的', '最近的']);
  });

  it('reads the same lines whichever byte its reads happen to start on, blank lines included', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, `\n${line(user('甲'))}\n\n${line(user('乙'))}`);
    for (let chunk = 1; chunk <= 40; chunk++) {
      expect(said((await readChatBefore(f, statSync(f).size, { turns: 5, chunk })).items)).toEqual(['甲', '乙']);
    }
  });

  it('takes a line longer than its budget rather than stall on it', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, line(user('早')) + line(assistant({ type: 'text', text: '长'.repeat(5000) })));
    const r = await readChatBefore(f, statSync(f).size, { turns: 5, maxRead: 100, chunk: 64 });
    expect(said(r.items)).toEqual(['长'.repeat(5000)]);
    expect(r.from).toBeGreaterThan(0);
  });

  it('reads the end of a file that has become shorter than where the copy the caller has starts', async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, line(user('新的')));
    const r = await readChatBefore(f, 10_000, { turns: 5 });
    expect(said(r.items)).toEqual(['新的']);
    expect(r.next).toBe(statSync(f).size);
  });
});

describe("a sub-agent's transcript", () => {
  const records = [user('查一下谁在读 epoch_utc'), assistant({ type: 'text', text: '找到两处。' })];
  const ownFile = () => {
    const f = join(scratch(), 'agent-a1.jsonl');
    writeFileSync(f, records.map((r) => line({ ...r, isSidechain: true, agentId: 'a1' })).join(''));
    return f;
  };
  const plain = async () => {
    const f = join(scratch(), 's.jsonl');
    writeFileSync(f, records.map(line).join(''));
    return (await readChat(f, 0)).items;
  };

  it("reads as the sub-agent's own conversation, the same as a conversation of its own would be", async () => {
    expect((await readChat(ownFile(), 0, { sidechain: true })).items).toEqual(await plain());
    expect((await readChatBefore(ownFile(), Number.MAX_SAFE_INTEGER, { sidechain: true })).items).toEqual(await plain());
  });

  it('reads what the sub-agent added since the last read as its own too', async () => {
    const f = ownFile();
    const { next } = await readChat(f, 0, { sidechain: true });
    appendFileSync(f, line({ ...assistant({ type: 'text', text: '改好了。' }), isSidechain: true }));
    expect((await readChat(f, next, { sidechain: true })).items).toEqual([{ k: 'text', text: '改好了。', at }]);
  });

  it("reads as nothing of a parent's conversation", async () => {
    expect((await readChat(ownFile(), 0)).items).toEqual([]);
  });

  describe('found by the call that started it', () => {
    const SID = '0b9c2a7e-1111-4222-8333-944445555666';
    const root = scratch();
    const subagents = join(root, '-proj', SID, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(root, '-proj', `${SID}.jsonl`), '');
    writeFileSync(join(subagents, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '查代码', toolUseId: 'toolu_01Ab' }));
    writeFileSync(join(subagents, 'agent-a1.jsonl'), '');
    writeFileSync(join(subagents, 'agent-a2.meta.json'), 'not json');

    it('finds its transcript and description under the conversation that started it', async () => {
      expect(await findSubagent(root, SID, 'toolu_01Ab')).toEqual({ path: join(subagents, 'agent-a1.jsonl'), description: '查代码' });
    });

    it.each([
      ['a call that started none', SID, 'toolu_02Cd'],
      ['a conversation that started none', '0b9c2a7e-1111-4222-8333-944445555667', 'toolu_01Ab'],
      ['an id that is a path', SID, '../toolu_01Ab'],
      ['a conversation id that is a path', '../-proj', 'toolu_01Ab'],
    ])('finds none for %s', async (_, sid, tool) => {
      expect(await findSubagent(root, sid, tool)).toBeNull();
    });
  });
});

describe('findTranscript', () => {
  it('finds a session by its id in whichever project folder it is in', async () => {
    const root = scratch();
    const id = '3f2a1b4c-0000-4000-8000-00000000000a';
    for (const d of ['-a', '-b']) writeFileSync(join(root, d === '-a' ? 'x' : 'y'), '');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, '-b'));
    writeFileSync(join(root, '-b', `${id}.jsonl`), '');
    expect(await findTranscript(root, id)).toBe(join(root, '-b', `${id}.jsonl`));
    expect(await findTranscript(root, '3f2a1b4c-0000-4000-8000-00000000000b')).toBeNull();
  });

  it('only looks up session ids, never paths', async () => {
    const root = scratch();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, '-a'));
    writeFileSync(join(root, 'elsewhere.jsonl'), '');
    expect(await findTranscript(root, '../elsewhere')).toBeNull();
  });
});

describe('lastSaid', () => {
  const file = (...records: unknown[]) => {
    const p = join(scratch(), 't.jsonl');
    writeFileSync(p, records.map(line).join(''));
    return p;
  };

  it('returns what Claude said last, as one line of plain words', async () => {
    const p = file(
      user('改一下'),
      assistant({ type: 'text', text: '先看看。' }),
      assistant({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts' }]),
      assistant({ type: 'text', text: '## 结论\n\n按钮改成 **圆角 8px**，见 [说明](https://x.test)：\n\n1. 改 `.btn`\n- 跑测试\n> 注意\n```css\n.btn {}\n```' }),
    );
    expect((await lastSaid(p)).reply).toBe('结论 按钮改成 圆角 8px，见 说明： 改 .btn 跑测试 注意 .btn {}');
  });

  it('returns the error when the turn ended in one', async () => {
    const p = file(
      user('改一下'),
      assistant({ type: 'text', text: '先看看。' }),
      assistant({ type: 'text', text: 'API Error: 529 Overloaded' }, { isApiErrorMessage: true }),
    );
    expect((await lastSaid(p)).reply).toBe('API Error: 529 Overloaded');
  });

  it('returns nothing before Claude has said anything', async () => {
    expect((await lastSaid(file(user('你好')))).reply).toBeNull();
    expect((await lastSaid(file())).reply).toBeNull();
  });

  it('keeps it short however long the reply', async () => {
    const reply = (await lastSaid(file(assistant({ type: 'text', text: '长'.repeat(5000) })))).reply!;
    expect(reply.length).toBe(120);
  });

  it('reads only the end of a long transcript, stepping over the line it starts in the middle of', async () => {
    const p = file(assistant({ type: 'text', text: '很早以前' }), user('x'.repeat(400_000)), assistant({ type: 'text', text: '最新的话' }));
    expect((await lastSaid(p, 64 * 1024)).reply).toBe('最新的话');
    expect((await lastSaid(file(assistant({ type: 'text', text: '很早以前' }), user('x'.repeat(400_000))), 64 * 1024)).reply).toBeNull();
  });

  it('tells when the last thing in the conversation happened, a step of Claude\'s work or a prompt', async () => {
    const when = (t: string) => ({ timestamp: t });
    expect((await lastSaid(file(user('改一下', when('2026-10-08T03:00:00.000Z')), assistant({ type: 'tool_use', id: 't1', name: 'Bash', input: {} }, when('2026-10-11T02:09:00.000Z'))))).at).toBe(
      Date.parse('2026-10-11T02:09:00.000Z'),
    );
    expect((await lastSaid(file(assistant({ type: 'text', text: '好' }, when('2026-10-10T01:00:00.000Z')), user('再来', when('2026-10-11T01:00:00.000Z'))))).at).toBe(
      Date.parse('2026-10-11T01:00:00.000Z'),
    );
  });

  it('tells no time when nothing in the conversation has one', async () => {
    expect((await lastSaid(file())).at).toBeNull();
    expect((await lastSaid(file({ type: 'ai-title', aiTitle: 'x' }))).at).toBeNull();
  });
});
