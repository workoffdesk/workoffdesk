import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAccounts } from '../../../../src/agents/claude/accounts.js';

// The Claude accounts on a Mac, as Claude Code keeps them: the default in ~/.claude with ~/.claude.json beside
// it, any other in a config dir of its own. The Keychain is never asked: `keychainHas` stands in for it.
const signedUp = (file: string, email: string, ready = true) => writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: email }, hasCompletedOnboarding: ready }));
const hashed = (dir: string) => `Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`;

const mac = () => {
  const home = mkdtempSync(join(tmpdir(), 'ts-mac-home-'));
  const projects = join(home, '.claude', 'projects');
  mkdirSync(projects, { recursive: true });
  signedUp(join(home, '.claude.json'), 'someone@example.com');
  const asked: string[] = [];
  const inKeychain = new Set(['Claude Code-credentials']);
  // A config dir; shared: it keeps its conversations in the default's projects folder.
  const dir = (path: string, email: string, o: { ready?: boolean; shared?: boolean; keychain?: boolean } = {}) => {
    mkdirSync(path, { recursive: true });
    signedUp(join(path, '.claude.json'), email, o.ready);
    if (o.shared) symlinkSync(projects, join(path, 'projects'));
    if (o.keychain) inKeychain.add(hashed(path));
    return path;
  };
  const accounts = (own?: string) =>
    new ClaudeAccounts({ home, projectsRoot: projects, own, keychainHas: async (s) => (asked.push(s), inKeychain.has(s)) });
  return { home, projects, dir, accounts, asked };
};
afterEach(() => vi.useRealTimers());

describe('ClaudeAccounts', () => {
  describe('list', () => {
    it('lists the default and each config dir with an account in it, in home or in ~/.config', async () => {
      const m = mac();
      const work = m.dir(join(m.home, '.claude-work'), 'work@example.com', { shared: true, keychain: true });
      const lab = m.dir(join(m.home, '.config', 'claude-lab'), 'lab@example.com', { ready: false });
      writeFileSync(join(lab, '.credentials.json'), '{}');
      expect(await m.accounts().list()).toEqual([
        { id: '', folder: '~/.claude', email: 'someone@example.com', signedIn: true, ready: true, shared: true },
        { id: work, folder: '~/.claude-work', email: 'work@example.com', signedIn: true, ready: true, shared: true },
        { id: lab, folder: '~/.config/claude-lab', email: 'lab@example.com', signedIn: true, ready: false, shared: false },
      ]);
      expect(m.asked).toEqual(['Claude Code-credentials', hashed(work), hashed(lab)]);
    });

    it('marks them signed out when neither the Keychain nor the dir holds what they sign in with', async () => {
      const m = mac();
      m.dir(join(m.home, '.claude-old'), 'old@example.com', { shared: true });
      expect((await m.accounts().list()).map((a) => [a.folder, a.signedIn])).toEqual([
        ['~/.claude', true],
        ['~/.claude-old', false],
      ]);
    });

    it.each<[string, (home: string) => void]>([
      ['a dir with no account', (home) => mkdirSync(join(home, '.cache'))],
      ['a dir whose account file is not one', (home) => (mkdirSync(join(home, '.broken')), writeFileSync(join(home, '.broken', '.claude.json'), '{oops'))],
      ['an account with no email', (home) => (mkdirSync(join(home, '.anon')), writeFileSync(join(home, '.anon', '.claude.json'), JSON.stringify({ oauthAccount: {} })))],
      ['an account whose email is empty', (home) => (mkdirSync(join(home, '.anon')), writeFileSync(join(home, '.anon', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: '' } })))],
      ['a folder in home that is not hidden', (home) => (mkdirSync(join(home, 'claude')), signedUp(join(home, 'claude', '.claude.json'), 'x@example.com'))],
      ['~/.claude itself, which is the default under another name', (home) => signedUp(join(home, '.claude', '.claude.json'), 'x@example.com')],
    ])('leaves out %s', async (_, make) => {
      const m = mac();
      make(m.home);
      expect((await m.accounts().list()).map((a) => a.folder)).toEqual(['~/.claude']);
    });

    it('marks them through the first run only when Claude Code says so in its own words', async () => {
      const m = mac();
      mkdirSync(join(m.home, '.claude-new'));
      writeFileSync(join(m.home, '.claude-new', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'new@example.com' }, hasCompletedOnboarding: 'yes' }));
      expect((await m.accounts().list()).map((a) => [a.email, a.ready])).toEqual([
        ['someone@example.com', true],
        ['new@example.com', false],
      ]);
    });

    it('lists a dir once however many names it goes by', async () => {
      const m = mac();
      const work = m.dir(join(m.home, '.claude-work'), 'work@example.com');
      symlinkSync(work, join(m.home, '.claude-alias'));
      expect((await m.accounts().list()).map((a) => a.email)).toEqual(['someone@example.com', 'work@example.com']);
    });

    it("lists the server's own config dir, wherever it is", async () => {
      const m = mac();
      const own = m.dir(join(mkdtempSync(join(tmpdir(), 'ts-elsewhere-')), 'claude'), 'own@example.com');
      expect((await m.accounts(own).list()).map((a) => [a.id, a.folder])).toEqual([
        ['', '~/.claude'],
        [own, own],
      ]);
    });

    it('lists none without a default account or any other', async () => {
      const m = mac();
      rmSync(join(m.home, '.claude.json'));
      expect(await m.accounts().list()).toEqual([]);
    });

    it('reads once for callers that ask together, and again only once the last read is 10 seconds old', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const m = mac();
      const a = m.accounts();
      expect(a.known()).toEqual([]);
      const [one, two] = await Promise.all([a.list(), a.list()]);
      expect(one).toBe(two);
      expect(a.known()).toBe(one);
      expect(m.asked).toHaveLength(1);
      vi.advanceTimersByTime(10_000 - 1);
      expect(await a.list()).toBe(one);
      vi.advanceTimersByTime(1);
      m.dir(join(m.home, '.claude-work'), 'work@example.com');
      expect((await a.list()).map((x) => x.email)).toEqual(['someone@example.com', 'work@example.com']);
      expect(m.asked).toHaveLength(3);
    });
  });

  describe('pickable', () => {
    it.each<[string, { signedIn: boolean; ready: boolean; shared: boolean }, boolean]>([
      ['signed in, through the first run, and keeping its conversations here', { signedIn: true, ready: true, shared: true }, true],
      ['signed out', { signedIn: false, ready: true, shared: true }, false],
      ['not through the first run, which no one at the phone can get through', { signedIn: true, ready: false, shared: true }, false],
      ['keeping its conversations apart', { signedIn: true, ready: true, shared: false }, false],
    ])('tells whether it can pick an account %s', (_, a, pickable) => {
      expect(mac().accounts().pickable({ id: 'x', folder: 'x', email: 'x@example.com', ...a })).toBe(pickable);
    });
  });

  describe('idOf and ownId', () => {
    it('returns the default when none is set, or when it is ~/.claude by any name', async () => {
      const m = mac();
      symlinkSync(join(m.home, '.claude'), join(m.home, 'claude-link'));
      const a = m.accounts();
      expect([a.idOf(undefined), a.idOf(''), a.idOf(join(m.home, '.claude')), a.idOf(join(m.home, 'claude-link'))]).toEqual(['', '', '', '']);
    });

    it('returns the account listed for it, by any name, once they are read', async () => {
      const m = mac();
      const work = m.dir(join(m.home, '.claude-work'), 'work@example.com');
      symlinkSync(work, join(m.home, 'work-link'));
      const a = m.accounts();
      expect(a.idOf(join(m.home, 'work-link'))).toBe(realpathSync(work));
      await a.list();
      expect(a.idOf(join(m.home, 'work-link'))).toBe(work);
    });

    it('returns nothing for a dir that is gone', () => {
      const m = mac();
      expect(m.accounts().idOf(join(m.home, '.gone'))).toBeUndefined();
    });

    it("returns, for the server's own, the default when its dir is unset or gone", () => {
      const m = mac();
      const other = m.dir(join(m.home, '.claude-work'), 'work@example.com');
      expect([m.accounts().ownId(), m.accounts(join(m.home, '.gone')).ownId(), m.accounts(other).ownId()]).toEqual(['', '', realpathSync(other)]);
    });
  });
});
