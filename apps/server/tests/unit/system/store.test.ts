import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envForHome, homeDir, tmuxSocketFor, writeJsonAtomic } from '../../../src/system/paths.js';
import { Store, emptyState } from '../../../src/system/store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ts-store-'));
const mode = (p: string) => statSync(p).mode & 0o777;

describe('homeDir', () => {
  it('creates WORKOFFDESK_HOME with mode 700', () => {
    const dir = join(tmp(), 'home');
    expect(homeDir({ WORKOFFDESK_HOME: dir })).toBe(dir);
    expect(mode(dir)).toBe(0o700);
  });

  it('defaults to ~/.workoffdesk', () => {
    const user = tmp();
    expect(homeDir({}, user)).toBe(join(user, '.workoffdesk'));
  });
});

describe('tmuxSocketFor', () => {
  it('gives the default home the workoffdesk socket', () => {
    expect(tmuxSocketFor('/Users/a/.workoffdesk', '/Users/a')).toBe('workoffdesk');
    expect(tmuxSocketFor('/Users/a/.workoffdesk/', '/Users/a')).toBe('workoffdesk');
  });

  it('gives every other home a tmux server of its own', () => {
    const a = tmuxSocketFor('/tmp/ts-a', '/Users/a');
    expect(a).toMatch(/^workoffdesk-[0-9a-f]{8}$/);
    expect(tmuxSocketFor('/tmp/ts-b', '/Users/a')).not.toBe(a);
    expect(tmuxSocketFor('/tmp/ts-a', '/Users/a')).toBe(a);
  });
});

describe('writeJsonAtomic', () => {
  it('writes readable JSON with mode 600', () => {
    const f = join(tmp(), 'a.json');
    writeJsonAtomic(f, { x: 1 });
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ x: 1 });
    expect(mode(f)).toBe(0o600);
  });

  describe('with several writers', () => {
    it('never lets a reader see a torn file while two processes write at once', async () => {
      const dir = tmp();
      const f = join(dir, 'state.json');
      writeJsonAtomic(f, { writer: 'none' });
      const child = join(dir, 'writer.ts');
      writeFileSync(
        child,
        `import { writeJsonAtomic } from ${JSON.stringify(join(__dirname, '../../../src/system/paths.ts'))};
const [file, name] = process.argv.slice(2);
const filler = name.repeat(20000);
for (let i = 0; i < 400; i++) writeJsonAtomic(file, { writer: name, i, filler });
`,
      );
      const run = (name: string) =>
        new Promise<number>((resolve) =>
          spawn(process.execPath, ['--import', 'tsx', child, f, name], { cwd: join(__dirname, '../../..'), stdio: 'inherit' }).on(
            'exit',
            (code) => resolve(code ?? 1),
          ),
        );
      let done = false;
      let torn = 0;
      let reads = 0;
      const writers = Promise.all([run('a'), run('b')]).finally(() => (done = true));
      while (!done) {
        try {
          JSON.parse(readFileSync(f, 'utf8'));
        } catch {
          torn++;
        }
        reads++;
        await new Promise((r) => setImmediate(r));
      }
      expect(await writers).toEqual([0, 0]);
      expect(reads).toBeGreaterThan(50);
      expect(torn).toBe(0);
      expect(JSON.parse(readFileSync(f, 'utf8')).i).toBe(399);
    }, 60_000);
  });
});

describe('Store', () => {
  it('starts from the empty state when no file exists', () => {
    const s = new Store(join(tmp(), 'state.json'));
    expect(s.get()).toEqual(emptyState());
  });

  it('persists updates across instances', () => {
    const f = join(tmp(), 'state.json');
    new Store(f).update((st) => {
      st.user = { username: 'alice', hash: 'h' };
    });
    expect(new Store(f).get().user).toEqual({ username: 'alice', hash: 'h' });
  });

  it('ignores a leftover half-written temp file', () => {
    const dir = tmp();
    const f = join(dir, 'state.json');
    new Store(f).update((st) => {
      st.user = { username: 'u', hash: 'h' };
    });
    writeFileSync(`${f}.tmp`, '{"user": {"usern');
    expect(new Store(f).get().user?.username).toBe('u');
  });

  it('fills fields missing from an older state file', () => {
    const f = join(tmp(), 'state.json');
    writeFileSync(f, JSON.stringify({ user: { username: 'u', hash: 'h' } }));
    const st = new Store(f).get();
    expect(st.passkeys).toEqual([]);
    expect(st.sessions).toEqual({});
  });

  // The CLI (setup) and the running server are separate processes on one file.
  describe('when shared with another process', () => {
    it('sees a write made through another Store on its next read', () => {
      const f = join(tmp(), 'state.json');
      const server = new Store(f);
      server.get();
      new Store(f).update((s) => {
        s.user = { username: 'alice', hash: 'new' };
      });
      expect(server.get().user?.hash).toBe('new');
    });

    it('builds its own update on top of the other write instead of overwriting it', () => {
      const f = join(tmp(), 'state.json');
      const server = new Store(f);
      server.update((s) => {
        s.user = { username: 'alice', hash: 'old' };
      });
      new Store(f).update((s) => {
        s.user = { username: 'alice', hash: 'new' };
      });
      server.update((s) => {
        s.pushSubs = [];
      });
      expect(JSON.parse(readFileSync(f, 'utf8')).user.hash).toBe('new');
    });

    it('keeps working when the file is removed underneath it', () => {
      const f = join(tmp(), 'state.json');
      const server = new Store(f);
      server.update((s) => {
        s.user = { username: 'alice', hash: 'h' };
      });
      rmSync(f);
      expect(server.get().user?.hash).toBe('h');
      server.update((s) => {
        s.pushSubs = [];
      });
      expect(JSON.parse(readFileSync(f, 'utf8')).user.hash).toBe('h');
    });
  });
});

describe('envForHome', () => {
  it('points a child at the given home, whatever home the parent carries', () => {
    const env = envForHome({ PATH: '/bin', WORKOFFDESK_HOME: '/live', HOME: '/Users/a' }, '/tmp/throwaway');
    expect(env).toEqual({ PATH: '/bin', WORKOFFDESK_HOME: '/tmp/throwaway', HOME: '/tmp/throwaway' });
    expect(homeDir(env)).toBe('/tmp/throwaway');
  });
});
