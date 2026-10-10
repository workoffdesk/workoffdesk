import { describe, expect, it } from 'vitest';
import { applyChat, applyOlder, cachedChat, type ChatItem, type ChatState, type Choices, emptyChat, filePath, forCache, hasDialog, hasOlder, type OnScreen, rows, type Turn, turns } from '../../src/model/chat';

const u = (text: string) => ({ k: 'user' as const, text });
const read = (sid: string | null, texts: string[], from: number, next: number) => ({ sid, items: texts.map(u), from, next, skipped: from > 0 });
const said = (s: ChatState) => s.items.map((i) => (i.k === 'user' ? i.text : ''));

describe('applyChat', () => {
  it('appends what was read after where the last read stopped', () => {
    const a = applyChat(emptyChat, read('s', ['一'], 0, 10));
    const b = applyChat(a, read('s', ['二'], 10, 20));
    expect(said(b)).toEqual(['一', '二']);
    expect(b.next).toBe(20);
    expect(hasOlder(b)).toBe(false);
  });

  it.each([
    ['the transcript changed (after /clear)', read('t', ['新'], 0, 5)],
    ['the file restarted shorter', read('s', ['新'], 0, 5)],
    ['a long transcript was opened at its end', read('s', ['新'], 900, 950)],
  ])('starts over when %s', (_, res) => {
    const before = applyChat(emptyChat, read('s', ['旧'], 0, 10));
    const after = applyChat(before, res);
    expect(said(after)).toEqual(['新']);
    expect(after).toMatchObject({ sid: res.sid, next: res.next });
    expect(hasOlder(after)).toBe(res.from > 0);
  });

  it('follows the session onto a new transcript even when nothing was read from the old one', () => {
    const before = applyChat(emptyChat, read('old', [], 0, 0));
    const after = applyChat(before, read('new', ['新'], 0, 5));
    expect(after).toMatchObject({ sid: 'new', next: 5 });
    // The next read asks for the new transcript, so it goes on from here instead of starting over each time.
    expect(applyChat(after, read('new', ['又'], 5, 9)).items).toHaveLength(2);
  });

  it("reads on in a conversation that started empty, as a shell's does", () => {
    const a = applyChat(emptyChat, read(null, [], 0, 0));
    const b = applyChat(a, read(null, ['一'], 0, 4));
    expect(said(b)).toEqual(['一']);
    expect(cachedChat(forCache(b, 10))).not.toBeNull();
  });

  it('still knows there is more before while reading on from the end', () => {
    const a = applyChat(emptyChat, read('s', ['一'], 900, 950));
    expect(hasOlder(applyChat(a, read('s', ['二'], 950, 990)))).toBe(true);
  });
});

describe('applyOlder', () => {
  it("puts the older page before what is shown, keeping each turn's key", () => {
    const a = applyChat(emptyChat, read('s', ['三', '四'], 900, 950));
    const keys = turns(a.items, a.base).map((t) => t.key);
    const b = applyOlder(a, read('s', ['一', '二'], 400, 900))!;
    expect(said(b)).toEqual(['一', '二', '三', '四']);
    expect(turns(b.items, b.base).map((t) => t.key).slice(2)).toEqual(keys);
    expect(hasOlder(b)).toBe(true);
    expect(hasOlder(applyOlder(b, read('s', ['零'], 0, 400))!)).toBe(false);
  });

  it('returns null when the page no longer joins up with what is shown', () => {
    const a = applyChat(emptyChat, read('s', ['三'], 900, 950));
    expect(applyOlder(a, read('t', ['别的'], 400, 900))).toBeNull();
    expect(applyOlder(a, read('s', ['别处'], 100, 800))).toBeNull();
  });
});

describe('forCache', () => {
  it('keeps the newest pages within the limit and knows where they start', () => {
    let s = applyChat(emptyChat, read('s', ['五', '六'], 900, 950));
    s = applyChat(s, read('s', ['七'], 950, 960));
    s = applyOlder(s, read('s', ['三', '四'], 600, 900))!;
    s = applyOlder(s, read('s', ['一', '二'], 0, 600))!;
    const kept = forCache(s, 5);
    expect(said(kept)).toEqual(['三', '四', '五', '六', '七']);
    expect(hasOlder(kept)).toBe(true);
    expect(applyOlder(kept, read('s', ['一', '二'], 0, 600))).not.toBeNull();
    const key = (c: ChatState) => turns(c.items, c.base).map((t) => t.key);
    expect(key(kept)).toEqual(key(s).slice(2));
    // The newest page is kept whole even past the limit: it is what opens first.
    expect(said(forCache(s, 1))).toEqual(['五', '六', '七']);
  });
});

describe('cachedChat', () => {
  it('restores only a cache in the shape it was kept in', () => {
    const good = forCache(applyChat(emptyChat, read('s', ['一'], 0, 10)), 100);
    expect(cachedChat(JSON.parse(JSON.stringify(good)))).toEqual(good);
    for (const bad of [null, 'x', {}, { ...good, items: 'x' }, { ...good, next: '1' }, { ...good, pages: [{ start: 'a', count: 1 }] }, { ...good, pages: [{ start: 0, count: 5 }] }]) {
      expect(cachedChat(bad)).toBeNull();
    }
  });
});

describe('turns', () => {
  describe('with tool calls', () => {
    it("puts a tool's output with the call that ran it, wherever it arrives", () => {
      const out = turns([
        { k: 'tool', id: 'a', name: 'Bash', summary: '跑测试' },
        { k: 'text', text: '在跑' },
        { k: 'result', id: 'a', text: 'ok', error: false },
      ], 0);
      expect(out).toEqual([
        { k: 'tool', id: 'a', name: 'Bash', summary: '跑测试', result: { text: 'ok', error: false }, key: 'a' },
        { k: 'text', text: '在跑', key: '1' },
      ]);
    });

    it('marks a tool result that was an image', () => {
      const out = turns([
        { k: 'tool', id: 'a', name: 'Read', summary: '/tmp/a.png' },
        { k: 'result', id: 'a', text: '[图片]', error: false, image: true },
      ], 0);
      expect(out[0]).toMatchObject({ result: { text: '[图片]', error: false, image: true } });
    });

    it('leaves a call with no result yet running and drops a result whose call was not read', () => {
      expect(turns([{ k: 'result', id: 'x', text: 'ok', error: false }, { k: 'tool', id: 'a', name: 'Read', summary: 'f' }], 0)).toEqual([
        { k: 'tool', id: 'a', name: 'Read', summary: 'f', result: undefined, key: 'a' },
      ]);
    });
  });

  // What Claude changed in its files, per reply: the edits of one reply (from the user's message to Claude's
  // last words) listed under those words, a file once with all its lines counted.
  describe('with edits', () => {
    const hunk = { oldStart: 1, newStart: 1, lines: ['-a', '+b'] };
    const edit = (id: string, file: string, added: number, removed: number, created?: true) => [
      { k: 'tool' as const, id, name: created ? 'Write' : 'Edit', summary: file },
      { k: 'result' as const, id, text: 'ok', error: false, diff: { file, added, removed, hunks: [hunk], ...(created ? { created } : {}) } },
    ];
    const changes = (out: ReturnType<typeof turns>) => out.filter((t) => t.k === 'changes');

    it('carries what an edit changed with its call', () => {
      expect(turns(edit('e1', '/p/a.ts', 1, 1), 0)[0]).toMatchObject({ result: { diff: { file: '/p/a.ts', added: 1, removed: 1, hunks: [hunk] } } });
    });

    it("lists a reply's changed files under its last words, a file edited twice once and a new file as new", () => {
      const out = turns(
        [
          { k: 'user', text: '改一下' },
          ...edit('e1', '/p/a.ts', 2, 1),
          ...edit('e2', '/p/new.md', 3, 0, true),
          ...edit('e3', '/p/a.ts', 1, 4),
          ...edit('e4', '/p/new.md', 1, 0),
          { k: 'text', text: '改好了' },
        ],
        0,
      );
      expect(out.map((t) => t.k)).toEqual(['user', 'tool', 'tool', 'tool', 'tool', 'text', 'changes']);
      expect(out.at(-1)).toMatchObject({
        k: 'changes',
        files: [
          { file: '/p/a.ts', added: 3, removed: 5, tool: 'e3' },
          { file: '/p/new.md', added: 4, removed: 0, created: true, tool: 'e4' },
        ],
      });
    });

    it('keeps each reply to its own changes', () => {
      const out = turns(
        [{ k: 'user', text: '一' }, ...edit('e1', '/p/a.ts', 1, 0), { k: 'text', text: '好' }, { k: 'user', text: '二' }, ...edit('e2', '/p/b.ts', 1, 0), { k: 'text', text: '好' }],
        0,
      );
      expect(changes(out).map((t) => t.k === 'changes' && t.files.map((f) => f.file))).toEqual([['/p/a.ts'], ['/p/b.ts']]);
      expect(out.map((t) => t.k)).toEqual(['user', 'tool', 'text', 'changes', 'user', 'tool', 'text', 'changes']);
    });

    it('lists nothing while Claude is still working, or for a reply that changed nothing', () => {
      expect(changes(turns([{ k: 'user', text: '改' }, ...edit('e1', '/p/a.ts', 1, 0)], 0))).toEqual([]);
      expect(changes(turns([{ k: 'user', text: '看看' }, { k: 'tool', id: 'r', name: 'Read', summary: '/p/a.ts' }, { k: 'text', text: '看完了' }], 0))).toEqual([]);
    });

    it('gives the list a key that stays put as more is read', () => {
      const items = [{ k: 'user' as const, text: '改' }, ...edit('e1', '/p/a.ts', 1, 0), { k: 'text' as const, text: '好' }];
      const keys = turns(items, 0).map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(turns([...items, { k: 'user', text: '再' }], 0).find((t) => t.k === 'changes')?.key).toBe(turns(items, 0).find((t) => t.k === 'changes')?.key);
    });
  });

  describe('in order', () => {
    const user = (text: string, at?: string): ChatItem => ({ k: 'user', text, ...(at && { at }) });
    const said = (text: string, at?: string): ChatItem => ({ k: 'text', text, ...(at && { at }) });
    const order = (items: ChatItem[]) => turns(items, 0).map((t) => ('text' in t ? t.text : t.key));

    it('puts a message sent while Claude worked back at the time it was sent', () => {
      expect(
        order([
          user('fix it', '2026-10-08T10:00:00Z'),
          said('looking', '2026-10-08T10:00:05Z'),
          said('found it', '2026-10-08T10:00:30Z'),
          said('fixed', '2026-10-08T10:01:00Z'),
          user('also the docs', '2026-10-08T10:00:20Z'),
        ]),
      ).toEqual(['fix it', 'looking', 'also the docs', 'found it', 'fixed']);
    });

    it('moves it past undated items but never before the message before it', () => {
      expect(
        order([
          user('first', '2026-10-08T10:00:00Z'),
          said('undated'),
          said('later', '2026-10-08T10:00:30Z'),
          user('second', '2026-10-08T09:00:00Z'),
        ]),
      ).toEqual(['first', 'undated', 'second', 'later']);
    });

    it('leaves a message in place when it is undated or sent after everything before it', () => {
      const items = [said('a', '2026-10-08T10:00:00Z'), user('no time'), said('b', '2026-10-08T10:00:10Z'), user('after', '2026-10-08T10:00:10Z')];
      expect(order(items)).toEqual(['a', 'no time', 'b', 'after']);
    });

    it('keeps the item keys whatever order they are shown in', () => {
      const out = turns([user('fix it', '2026-10-08T10:00:00Z'), said('done', '2026-10-08T10:00:30Z'), user('also', '2026-10-08T10:00:20Z')], 10);
      expect(out.map((t) => t.key)).toEqual(['10', '12', '11']);
    });
  });
});

describe('filePath', () => {
  it.each([
    ['/Users/alice/p/src/a.ts', { name: 'a.ts', dir: '~/p/src' }],
    ['/etc/hosts', { name: 'hosts', dir: '/etc' }],
    ['/x', { name: 'x', dir: '/' }],
    ['/Users/alice/Library/Application Support/a b.json', { name: 'a b.json', dir: '~/Library/Application Support' }],
  ])('puts the name of %s first', (p, parts) => {
    expect(filePath(p)).toEqual(parts);
  });

  it.each([['src/a.ts'], ['/'], ['']])('leaves %j as it is', (s) => {
    expect(filePath(s)).toBeNull();
  });
});

const call = (id: string): Turn => ({ k: 'tool', id, name: 'Read', summary: `/a/${id}`, result: { text: 'ok', error: false }, key: id });
const reply = (key: string): Turn => ({ k: 'text', text: 'Found it.', key });
const tools = (drawn: ReturnType<typeof rows>) => drawn.filter((r) => r.k === 'tools');

describe('rows', () => {
  // Between one call's answer and the next call, every call has its answer, yet the turn goes on.
  it('keeps a run of calls going while Claude works and nothing came after it', () => {
    expect(tools(rows([reply('r'), call('a'), call('b')], true)).map((r) => r.going)).toEqual([true]);
  });

  it.each([
    ['Claude has stopped', [reply('r'), call('a'), call('b')], false],
    ['a reply came after them', [call('a'), call('b'), reply('r')], true],
  ])('marks a run of calls done once %s', (_, shown, working) => {
    expect(tools(rows(shown, working)).map((r) => r.going)).toEqual([false]);
  });

  it('marks a run of calls done when more calls came after the reply that followed them', () => {
    expect(tools(rows([call('a'), call('b'), reply('r'), call('c'), call('d')], true)).map((r) => r.going)).toEqual([false, true]);
  });
});

const choices = (over: Partial<Choices> = {}): Choices => ({ context: 'Pick one', options: [{ label: 'A', detail: '' }], cursor: 0, ...over });
const panel = { title: 'Status', body: '', hint: '' };
const on = (over: Partial<OnScreen>): OnScreen => ({ choices: null, panel: null, ...over });

describe('hasDialog', () => {
  it.each([
    ['a panel', on({ panel }), true],
    ['a picker the person opened', on({ choices: choices({ opened: true }) }), true],
    ['a picker with ticks to submit', on({ choices: choices({ opened: true, submit: 'Submit' }) }), false],
    ['a question Claude asks', on({ choices: choices() }), false],
    ['nothing', on({}), false],
  ])('tells whether %s is a dialog', (_, screen, up) => {
    expect(hasDialog(screen)).toBe(up);
  });
});
