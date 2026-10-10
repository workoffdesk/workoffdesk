import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heldInBackground, listProjectDirs, listRecentClaudeSessions } from '../../../../../src/agents/claude/transcript/transcripts.js';

const U1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const U2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const U3 = 'aaaaaaaa-0000-0000-0000-000000000003';
const U4 = 'aaaaaaaa-0000-0000-0000-000000000004';
const U5 = 'aaaaaaaa-0000-0000-0000-000000000005';
const U6 = 'aaaaaaaa-0000-0000-0000-000000000006';
const U7 = 'aaaaaaaa-0000-0000-0000-000000000007';
const U8 = 'aaaaaaaa-0000-0000-0000-000000000008';

const line = (o: object) => `${JSON.stringify(o)}\n`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
  const proj = join(root, '-Users-me-proj');
  mkdirSync(proj);
  const put = (id: string, body: string, mtime: number) => {
    const f = join(proj, `${id}.jsonl`);
    writeFileSync(f, body);
    utimesSync(f, mtime, mtime);
  };
  put(
    U1,
    line({ type: 'permission-mode', sessionId: U1 }) +
      line({ type: 'user', cwd: '/Users/me/proj', message: { role: 'user', content: 'first question' } }) +
      line({ type: 'ai-title', aiTitle: 'Early title', sessionId: U1 }) +
      line({ type: 'ai-title', aiTitle: 'Final title', sessionId: U1 }),
    1000,
  );
  put(
    U2,
    line({ type: 'user', cwd: '/Users/me/other', message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(100) }] } }),
    2000,
  );
  put(U3, line({ type: 'user', cwd: '/Users/me/proj', message: { content: 'ok' } }) + '{"type":"ai-title","aiT', 3000);
  put(U4, 'this is not json at all\n<html>', 4000);
  put(U5, '', 5000);
  const filler = line({ type: 'assistant', message: { content: 'y'.repeat(2000) } }).repeat(800);
  put(
    U6,
    line({ type: 'user', cwd: '/Users/me/big', message: { content: 'big one' } }) + filler + line({ type: 'ai-title', aiTitle: 'Title at the end' }),
    6000,
  );
  put(U7, line({ type: 'system', content: 'no user, no cwd' }), 7000);
  put(
    U8,
    line({ type: 'user', cwd: '/x', message: { content: '<command-name>/clear</command-name>' } }) +
      line({ type: 'user', message: { content: '  real\n  question  ' } }),
    500,
  );
  writeFileSync(join(proj, 'notes.txt'), 'ignore me');
  return root;
}

describe('listRecentClaudeSessions', () => {
  it('returns sessions newest first with cwd, title and activity', async () => {
    const got = await listRecentClaudeSessions(fixture());
    const byId = Object.fromEntries(got.map((s) => [s.sessionId, s]));
    expect(got[0].sessionId).toBe(U7);
    expect(byId[U1]).toEqual({
      sessionId: U1,
      cwd: '/Users/me/proj',
      title: 'Final title',
      lastPrompt: 'first question',
      lastActivity: 1_000_000,
      automated: false,
    });
    expect(byId[U2].title).toBe('x'.repeat(60));
    expect(byId[U3].title).toBe('ok');
    expect(byId[U6].title).toBe('Title at the end');
    expect(byId[U6].cwd).toBe('/Users/me/big');
    expect(byId[U7]).toMatchObject({ cwd: null, title: 'aaaaaaaa' });
    expect(byId[U8].title).toBe('real question');
  });

  it('skips files with nothing usable', async () => {
    const ids = (await listRecentClaudeSessions(fixture())).map((s) => s.sessionId);
    expect(ids).not.toContain(U4);
    expect(ids).not.toContain(U5);
    expect(ids).toHaveLength(6);
  });

  it('honours the limit', async () => {
    expect(await listRecentClaudeSessions(fixture(), 2)).toHaveLength(2);
  });

  // What an agent runner (Paperclip) starts through the SDK, the way its transcripts write it.
  const WAKE = [
    '## Paperclip Wake Payload',
    '',
    'Use this wake to continue the task, applying new user direction and preserving its approval gates.',
    '',
    '- reason: issue_assigned',
    '- issue: MEM-717 出 Ofrenda 4 张素材图',
    '- fallback fetch needed: no',
  ].join('\n');

  function mixed(automated: number, people: number) {
    const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
    mkdirSync(join(root, '-p'));
    let t = 10_000;
    const put = (id: string, body: string) => {
      const f = join(root, '-p', `${id}.jsonl`);
      writeFileSync(f, body);
      utimesSync(f, t, t);
      t += 1;
    };
    for (let i = 0; i < people; i++)
      put(`bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`, line({ type: 'user', entrypoint: 'cli', cwd: '/p', message: { content: `person ${i}` } }));
    for (let i = 0; i < automated; i++)
      put(`cccccccc-0000-0000-0000-${String(i).padStart(12, '0')}`, line({ type: 'user', entrypoint: 'sdk-cli', cwd: '/p', message: { content: WAKE } }));
    return root;
  }

  it('tells the sessions an agent runner started from the ones a person did', async () => {
    const got = await listRecentClaudeSessions(mixed(1, 1));
    expect(got.map((s) => s.automated).sort()).toEqual([false, true]);
  });

  it('names a session started for an issue by the issue, not the wake template', async () => {
    const [s] = await listRecentClaudeSessions(mixed(1, 0));
    expect(s.title).toBe('MEM-717 出 Ofrenda 4 张素材图');
  });

  it('names a session by what was said, without the markdown marks of a heading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
    mkdirSync(join(root, '-p'));
    writeFileSync(join(root, '-p', `${U1}.jsonl`), line({ type: 'user', cwd: '/p', message: { content: '## Fix the login\n\nthe button is square' } }));
    expect((await listRecentClaudeSessions(root))[0].title).toBe('Fix the login the button is square');
  });

  it('keeps the sessions of people in the list however many an agent runner started since', async () => {
    const got = await listRecentClaudeSessions(mixed(40, 5), 10);
    expect(got.filter((s) => !s.automated)).toHaveLength(5);
    expect(got.filter((s) => s.automated)).toHaveLength(10);
  });

  it('returns nothing for a missing root', async () => {
    expect(await listRecentClaudeSessions('/definitely/not/here')).toEqual([]);
  });

  it.skipIf(!existsSync(join(process.env.TEST_REAL_HOME!, '.claude', 'projects')))(
    'parses the real ~/.claude/projects without throwing',
    async () => {
      const got = await listRecentClaudeSessions(join(process.env.TEST_REAL_HOME!, '.claude', 'projects'), 200);
      expect(got.length).toBeGreaterThan(0);
      expect(got.filter((s) => s.cwd).length).toBeGreaterThanOrEqual(got.length / 2);
      for (const s of got) expect(s.title.length).toBeGreaterThan(0);
    },
  );

  // Claude Code's /rename writes the name into the transcript, again later on, so the last one is the name.
  describe('when a conversation was renamed in Claude Code', () => {
    const titled = async (...records: object[]) => {
      const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
      mkdirSync(join(root, '-p'));
      writeFileSync(join(root, '-p', `${U1}.jsonl`), [{ type: 'user', cwd: '/Users/me/p', message: { content: 'first question' } }, ...records].map(line).join(''));
      return (await listRecentClaudeSessions(root))[0]?.title;
    };

    it('names it by that name rather than the title Claude made up, whichever came later', async () => {
      expect(await titled({ type: 'custom-title', customTitle: 'Renamed', sessionId: U1 }, { type: 'ai-title', aiTitle: 'Made up' })).toBe('Renamed');
      expect(await titled({ type: 'ai-title', aiTitle: 'Made up' }, { type: 'custom-title', customTitle: 'Renamed' })).toBe('Renamed');
    });

    it('names it by the last name it was given', async () => {
      expect(await titled({ type: 'custom-title', customTitle: 'Old' }, { type: 'custom-title', customTitle: 'New' })).toBe('New');
    });

    it('keeps the name on one line, cut to the length of a title', async () => {
      expect(await titled({ type: 'custom-title', customTitle: `  a\n\tb ${'x'.repeat(100)}` })).toBe(`a b ${'x'.repeat(56)}`);
    });

    it('does not name it by an empty one', async () => {
      expect(await titled({ type: 'custom-title', customTitle: '  ' }, { type: 'ai-title', aiTitle: 'Made up' })).toBe('Made up');
      expect(await titled({ type: 'custom-title', customTitle: 5 })).toBe('first question');
    });
  });

  describe('the last prompt', () => {
    const said = async (...records: object[]) => {
      const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
      mkdirSync(join(root, '-p'));
      writeFileSync(join(root, '-p', `${U1}.jsonl`), records.map(line).join(''));
      return (await listRecentClaudeSessions(root))[0]?.lastPrompt;
    };
    const user = (content: unknown, more: object = {}) => ({ type: 'user', cwd: '/Users/me/p', message: { role: 'user', content }, ...more });

    it('reads the latest thing typed, not the first', async () => {
      expect(await said(user('first'), { type: 'assistant', message: { content: 'ok' } }, user('second'), user('third'))).toBe('third');
    });

    it.each<[string, object]>([
      ['a tool result', user([{ type: 'tool_result', tool_use_id: 't', content: 'output' }])],
      ['a slash command', user('<command-name>/clear</command-name>')],
      ['a line Claude Code adds of its own', user('Caveat: the messages below were generated by the user', { isMeta: true })],
      ['the summary a compaction leaves', user('This session is being continued from a previous conversation', { isCompactSummary: true })],
    ])('does not read %s that came after it', async (_, after) => {
      expect(await said(user('the real question'), after)).toBe('the real question');
    });

    it('reads the one Claude Code writes down as the last prompt, when that comes later', async () => {
      expect(await said(user('typed'), { type: 'last-prompt', lastPrompt: 'written down', sessionId: U1 })).toBe('written down');
      expect(await said({ type: 'last-prompt', lastPrompt: 'written down' }, user('typed after'))).toBe('typed after');
    });

    it('reads the text of a prompt that came with a picture', async () => {
      expect(await said(user([{ type: 'image', source: {} }, { type: 'text', text: 'what is' }, { type: 'text', text: 'this?' }]))).toBe('what is this?');
    });

    it('keeps it on one line, cut at 200 characters, whole ones', async () => {
      const long = `  a\n\tb ${'字'.repeat(300)}`;
      expect(await said(user(long))).toBe(`a b ${'字'.repeat(196)}`);
    });

    it('reads none when the person said nothing yet', async () => {
      expect(await said({ type: 'permission-mode', sessionId: U1 }, user([{ type: 'tool_result', content: 'x' }]))).toBeNull();
    });

    it('finds it at the end of a transcript too long to read whole', async () => {
      const filler = { type: 'assistant', message: { content: 'y'.repeat(2000) } };
      expect(await said(user('at the start'), ...Array(800).fill(filler), user('at the end'))).toBe('at the end');
    });
  });

  // Each record's cwd is the folder Claude's shell was in; `claude --resume` from another folder keeps writing
  // the same file from there (Claude Code 2.1.295 and 2.1.296).
  describe('the folder a conversation is in', () => {
    const folderOf = async (...cwds: (string | null)[]) => {
      const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
      mkdirSync(join(root, '-p'));
      const body = cwds.map((cwd) => line(cwd === null ? { type: 'ai-title', aiTitle: 't' } : { type: 'user', cwd, message: { content: 'x' } })).join('');
      writeFileSync(join(root, '-p', `${U1}.jsonl`), body);
      return (await listRecentClaudeSessions(root))[0].cwd;
    };

    it.each<[string, (string | null)[], string]>([
      ['only ever in one', ['/a', '/a'], '/a'],
      ['in its own folder after a cd into one inside it', ['/a', '/a/sub', '/a'], '/a'],
      ['in its own folder while the last records come from one inside it', ['/a', '/a/sub', '/a/sub/deep'], '/a'],
      ['the one it was resumed in', ['/a', '/a', '/b'], '/b'],
      ['the one it was resumed in, from records inside it', ['/a', '/b', '/b/sub'], '/b'],
      ['the one it was resumed in last, after one in between', ['/a', '/b', '/a', '/a/sub'], '/a'],
      ['the one it was resumed in, when that holds the one before', ['/a/sub', '/a/sub/deep', '/a'], '/a'],
      ['the one it was resumed in, inside one it ran in before another', ['/a', '/c', '/a/b'], '/a/b'],
      ['the root, when it ran there', ['/', '/x'], '/'],
      ['named by the last record that names one', ['/a', '/b', null], '/b'],
      ['not a folder that only starts like the one before', ['/a', '/ab'], '/ab'],
    ])('is %s', async (_, cwds, folder) => {
      expect(await folderOf(...cwds)).toBe(folder);
    });

    it('is the one it was resumed in when that is past the start of a transcript too long to read whole', async () => {
      const filler = { type: 'assistant', message: { content: 'y'.repeat(2000) } };
      const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
      mkdirSync(join(root, '-p'));
      const records = [{ type: 'user', cwd: '/a', message: { content: 'x' } }, ...Array(800).fill(filler), { type: 'user', cwd: '/b/sub', message: { content: 'y' } }, { type: 'user', cwd: '/b', message: { content: 'z' } }];
      writeFileSync(join(root, '-p', `${U1}.jsonl`), records.map(line).join(''));
      expect((await listRecentClaudeSessions(root))[0].cwd).toBe('/b');
    });
  });

  describe('with throwaway runs and repeated reads', () => {
    const at = (cwd: string) => {
      const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
      mkdirSync(join(root, '-p'));
      const f = join(root, '-p', `${U1}.jsonl`);
      writeFileSync(f, line({ type: 'user', cwd, message: { content: 'hello' } }));
      return { root, f };
    };

    it.each(['/tmp/probe', '/private/tmp/x', '/var/folders/ab/T/run', '/private/var/folders/ab/T/run', join(tmpdir(), 'vitest-1')])(
      'leaves out a throwaway run in a temporary folder (%s)',
      async (cwd) => {
        expect(await listRecentClaudeSessions(at(cwd).root)).toEqual([]);
      },
    );

    it('keeps a conversation in a folder that only starts like a temporary one', async () => {
      expect(await listRecentClaudeSessions(at('/tmpfiles/work').root)).toHaveLength(1);
    });

    it('reads a transcript again once it changed, and not before', async () => {
      const { root, f } = at('/Users/me/p');
      utimesSync(f, 1000, 1000);
      expect((await listRecentClaudeSessions(root))[0].lastPrompt).toBe('hello');
      writeFileSync(f, line({ type: 'user', cwd: '/Users/me/p', message: { content: 'hello' } }) + line({ type: 'user', message: { content: 'again' } }));
      utimesSync(f, 2000, 2000);
      expect((await listRecentClaudeSessions(root))[0]).toMatchObject({ lastPrompt: 'again', lastActivity: 2_000_000 });
    });

    it('reads a transcript again when it was written over at the same length', async () => {
      const { root, f } = at('/Users/me/p');
      utimesSync(f, 1000, 1000);
      expect((await listRecentClaudeSessions(root))[0].lastPrompt).toBe('hello');
      writeFileSync(f, line({ type: 'user', cwd: '/Users/me/p', message: { content: 'howdy' } }));
      utimesSync(f, 2000, 2000);
      expect((await listRecentClaudeSessions(root))[0].lastPrompt).toBe('howdy');
    });

    it('answers callers that ask while it is listing with the same listing', async () => {
      const { root } = at('/Users/me/p');
      const [a, b] = [listRecentClaudeSessions(root), listRecentClaudeSessions(root)];
      expect(a).toBe(b);
      await a;
      expect(listRecentClaudeSessions(root)).not.toBe(a);
    });
  });
});

describe('listProjectDirs', () => {
  it('dedupes cwds by recency and appends pinned dirs', () => {
    const dirs = listProjectDirs(
      [
        { sessionId: '1', cwd: '/a', title: '', lastActivity: 3 },
        { sessionId: '2', cwd: null, title: '', lastActivity: 2 },
        { sessionId: '3', cwd: '/b', title: '', lastActivity: 2 },
        { sessionId: '4', cwd: '/a', title: '', lastActivity: 1 },
      ],
      ['/pinned', '/b'],
    );
    expect(dirs).toEqual(['/pinned', '/b', '/a']);
  });
});

// Shapes from ~/.claude/jobs of Claude Code 2.1.289: one folder per background session, named by the first
// eight characters of its conversation, with state.json naming the transcript it follows once it has one.
describe('heldInBackground', () => {
  const FOLLOWED = '6e36fce3-f9fd-4ac2-ba5e-50e10fdb01db';
  const NAMED = '9e403f46-9d2f-4691-aa32-2e04e5a34ecd';
  const MOVED = '1a8fa7b4-7ab8-4bf9-ad81-da7a240c0565';
  const FREE = '0738c6cd-11e8-490f-ac51-ddb454fabdfd';

  function jobs() {
    const root = mkdtempSync(join(tmpdir(), 'ts-jobs-'));
    const job = (name: string, state?: object | string) => {
      mkdirSync(join(root, name, 'tmp'), { recursive: true });
      if (state !== undefined) writeFileSync(join(root, name, 'state.json'), typeof state === 'string' ? state : JSON.stringify(state));
    };
    job('6e36fce3', { state: 'blocked', linkScanPath: `/Users/me/.claude/projects/-proj/${FOLLOWED}.jsonl` });
    job('9e403f46', { state: 'working', linkScanOffset: 0, template: 'bg' });
    // A job whose folder is named apart from the conversation it follows.
    job('c0ffee00', { state: 'done', linkScanPath: `/Users/me/.claude/projects/-proj/${MOVED}.jsonl` });
    // Left behind with no state: not a background session.
    job('0738c6cd');
    job('broken00', '{"state":');
    writeFileSync(join(root, 'pins.json'), '[]');
    return root;
  }

  it.each([
    ['the conversation a background session follows', FOLLOWED],
    ['one a background session is named after, before it follows a transcript', NAMED],
    ['one followed by a session named otherwise', MOVED],
  ])('holds %s', async (_, id) => {
    expect((await heldInBackground(jobs()))(id)).toBe(true);
  });

  it('does not hold a conversation no background session has, even with a folder left behind under its name', async () => {
    expect((await heldInBackground(jobs()))(FREE)).toBe(false);
  });

  it('holds nothing when Claude Code has no background sessions here', async () => {
    expect((await heldInBackground(join(tmpdir(), 'ts-no-such-jobs-dir')))(FOLLOWED)).toBe(false);
  });
});
