import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { writeJsonAtomic } from './paths.js';

export type User = { username: string; hash: string };

export type Passkey = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  name: string;
  createdAt: number;
  lastUsedAt?: number;
};

export type Login = {
  id: string;
  createdAt: number;
  lastSeen: number;
  ua: string;
  method: 'password' | 'passkey';
};

export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
};

// An iPhone app that asked for notifications. words: what to say for each event, in the phone's language.
export type ApnsDeviceRecord = {
  token: string;
  topic: string;
  words: { waiting: string; idle: string };
  host?: 'production' | 'sandbox';
  createdAt: number;
};

export type SessionKind = 'shell' | 'claude' | 'codex';

// title: the name given the session, or its directory's; named: it was given one (here, or by /rename in
// Claude). What the agent calls its conversation: customTitle, a name given there before it came here;
// aiTitle, what Claude or Codex made of it.
export type SessionMeta = {
  title: string;
  named?: boolean;
  customTitle?: string;
  aiTitle?: string;
  // A name given here that its agent has not taken yet.
  naming?: string;
  kind: SessionKind;
  cwd: string;
  claudeSessionId?: string;
  // The Codex thread a codex session holds, once known.
  codexThreadId?: string;
  // The config dir its Claude runs with, "" for the default; unknown for one started before this was kept.
  claudeDir?: string;
  // Its Claude was started with a terminal's environment, and so runs on that terminal's account.
  terminal?: boolean;
  // To be moved to the account in use once its turn is over.
  moving?: boolean;
  createdAt: number;
};

// What a session is called: the name given it, else what its agent calls the conversation, else its
// directory's name. One kept without named was given its name unless that is the directory's.
export function shownTitle(meta: SessionMeta): string {
  const named = meta.named ?? meta.title !== (basename(meta.cwd) || meta.cwd);
  return named ? meta.title : (meta.customTitle ?? meta.aiTitle ?? meta.title);
}

// One of a plan's limits: the share used, and when it resets.
export type Limit = { used: number; resetsAt?: number };

// What a Claude account had used when one of its sessions last said; at: when, in ms.
export type AccountLimits = { fiveHour?: Limit; sevenDay?: Limit; at: number };

export type State = {
  user?: User;
  passkeys: Passkey[];
  logins: Login[];
  pushSubs: PushSub[];
  apnsDevices: ApnsDeviceRecord[];
  sessions: Record<string, SessionMeta>;
  // The names given here to sessions, by the Claude conversation each held, kept after the session ends.
  claudeNames: Record<string, string>;
  // The Claude account picked for sessions started here (its config dir, "" the default); unset until one is.
  claudeAccount?: string;
  // What each Claude account had used when its sessions last said, by config dir.
  claudeLimits?: Record<string, AccountLimits>;
  vapid?: { publicKey: string; privateKey: string };
};

export function emptyState(): State {
  return { passkeys: [], logins: [], pushSubs: [], apnsDevices: [], sessions: {}, claudeNames: {} };
}

export class Store {
  private state: State = emptyState();
  private version = '';

  constructor(readonly file: string) {
    this.reload();
  }

  get(): State {
    this.reload();
    return this.state;
  }

  update(fn: (s: State) => void): void {
    const next = structuredClone(this.get());
    fn(next);
    writeJsonAtomic(this.file, next);
    this.state = next;
  }

  // Atomic writes replace the inode, so any write by another process changes the version.
  private reload(): void {
    const version = fileVersion(this.file);
    if (!version || version === this.version) return;
    this.state = { ...emptyState(), ...JSON.parse(readFileSync(this.file, 'utf8')) };
    this.version = version;
  }
}

function fileVersion(file: string): string {
  const st = statSync(file, { throwIfNoEntry: false });
  return st ? `${st.ino}:${st.mtimeMs}:${st.size}` : '';
}
