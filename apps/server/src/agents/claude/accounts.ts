import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountLimits } from '../../system/store.js';

// The Claude accounts on this Mac. Claude Code keeps each in a config dir picked by CLAUDE_CONFIG_DIR: the
// default is ~/.claude with ~/.claude.json beside it and the Keychain item "Claude Code-credentials"; any
// other dir holds its own .claude.json, its item named after the first 8 hex of the dir's sha256. Setting the
// variable to ~/.claude is not the default: Claude Code then looks for the hashed item.
export type ClaudeAccount = {
  // The config dir, "" for the default (the variable unset).
  id: string;
  // The dir as shown, under ~.
  folder: string;
  email: string;
  signedIn: boolean;
  // Done with Claude Code's first-run wizard, which no one at the phone can get through.
  ready: boolean;
  // Keeps its conversations where this server reads them, so any of them can be gone on with on it.
  shared: boolean;
};

// The accounts with what each used when last seen, the one new sessions run on, and whether one was picked; the
// open sessions on another account, and those of them to move to it once their turn is over.
export type AccountsView = { accounts: (ClaudeAccount & { limits: AccountLimits | null })[]; inUse: string; picked: boolean; elsewhere: number; moving: number };

const FRESH_MS = 10_000;
const SECURITY_MS = 5_000;

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

function readAccount(file: string): { email: string; ready: boolean } | null {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { oauthAccount?: { emailAddress?: unknown }; hasCompletedOnboarding?: unknown };
    const email = j.oauthAccount?.emailAddress;
    return typeof email === 'string' && email ? { email, ready: j.hasCompletedOnboarding === true } : null;
  } catch {
    return null;
  }
}

// Only the item's attributes are read: no prompt, and no secret leaves the Keychain.
const keychainHas = (service: string) =>
  new Promise<boolean>((resolve) => execFile('/usr/bin/security', ['find-generic-password', '-s', service], { timeout: SECURITY_MS }, (err) => resolve(!err)));

export class ClaudeAccounts {
  private last: { at: number; accounts: ClaudeAccount[] } | null = null;
  private reading: Promise<ClaudeAccount[]> | null = null;

  constructor(private readonly o: { home: string; projectsRoot: string; own?: string; keychainHas?: (service: string) => Promise<boolean> }) {}

  // Read anew once the last read is FRESH_MS old, one read at a time.
  list(): Promise<ClaudeAccount[]> {
    if (this.last && Date.now() - this.last.at < FRESH_MS) return Promise.resolve(this.last.accounts);
    this.reading ??= this.read().finally(() => (this.reading = null));
    return this.reading;
  }

  // The last read, for what cannot wait on one.
  known(): ClaudeAccount[] {
    return this.last?.accounts ?? [];
  }

  pickable(a: ClaudeAccount): boolean {
    return a.signedIn && a.ready && a.shared;
  }

  // The account a config dir is, however it is spelled; unset is the default. undefined: a dir that is gone.
  idOf(dir: string | undefined): string | undefined {
    if (!dir) return '';
    const r = real(dir);
    if (r === null) return undefined;
    if (r === real(join(this.o.home, '.claude'))) return '';
    return this.known().find((a) => a.id && real(a.id) === r)?.id ?? r;
  }

  // The account this server's own environment gives a Claude.
  ownId(): string {
    return this.idOf(this.o.own) ?? '';
  }

  private folder(dir: string): string {
    return dir.startsWith(`${this.o.home}/`) ? `~${dir.slice(this.o.home.length)}` : dir;
  }

  private async read(): Promise<ClaudeAccount[]> {
    const has = this.o.keychainHas ?? keychainHas;
    const projects = real(this.o.projectsRoot);
    const home = join(this.o.home, '.claude');
    const dirs: string[] = this.o.own ? [this.o.own] : [];
    for (const parent of [this.o.home, join(this.o.home, '.config')]) {
      let names: string[] = [];
      try {
        names = readdirSync(parent);
      } catch {
        continue;
      }
      for (const name of names) if (parent !== this.o.home || name.startsWith('.')) dirs.push(join(parent, name));
    }
    const accounts: ClaudeAccount[] = [];
    const seen = new Set<string>();
    const add = async (id: string, dir: string, file: string, service: string) => {
      const r = real(dir);
      if (r === null || seen.has(r)) return;
      const found = readAccount(file);
      if (!found) return;
      seen.add(r);
      const signedIn = (await has(service)) || existsSync(join(dir, '.credentials.json'));
      accounts.push({ id, folder: this.folder(dir), email: found.email, signedIn, ready: found.ready, shared: projects !== null && real(join(dir, 'projects')) === projects });
    };
    await add('', home, join(this.o.home, '.claude.json'), 'Claude Code-credentials');
    for (const dir of dirs) {
      if (dir === home) continue;
      await add(dir, dir, join(dir, '.claude.json'), `Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`);
    }
    this.last = { at: Date.now(), accounts };
    return accounts;
  }
}
