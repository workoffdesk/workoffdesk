import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { CodexAgent } from './agent.js';

// The Codex conversations people had on this Mac, and where each is open now (docs/design/
// 2026-10-08-codex-on-the-mac.md). Codex lets one process at a time write a thread: whichever holds the flock
// on its file in thread-writer-locks.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export type CodexThread = { id: string; cwd: string; title: string; path: string | null; updatedAt: number };

// here: this server's own app server has it (a session here, or one that just ended). terminal: a Codex in a
// terminal on the Mac, which can be told to quit, and since when it runs. elsewhere: another app's server (an editor's, the desktop
// app's), a Codex inside a WorkOffDesk session, or `codex exec`; never stopped from here.
export type CodexHolder = { at: 'here' } | { at: 'terminal'; pid: number; tty: string | null; since: number } | { at: 'elsewhere' };

// busy: a turn has started in the terminal's Codex and not ended, as its rollout says; a turn waiting on an
// approval is busy too.
export type CodexOnMac = CodexThread & { holder: CodexHolder | null; busy: boolean; lastPrompt: string | null; lastActivity: number };

const LIMIT = 50;
const ALL_PAGE = 100;
// How long the list is kept: it takes the app server seconds to make.
const KEEP_MS = 5 * 60_000;
// How much of the end of a rollout is read for how its last turn went and what the person said last.
const TAIL = 64 * 1024;
const RUN_MS = 5_000;
const PROMPT_MAX = 200;

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(bin, args, { timeout: RUN_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      // lsof says 1 when some file asked about is open nowhere; what it found is still on stdout.
      err && !stdout ? reject(err) : resolve(String(stdout)),
    ),
  );

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// A thread people opened themselves: from the TUI or an editor, not `codex exec` or a subagent.
function threadOf(v: unknown): CodexThread | null {
  const t = obj(v);
  const source = t?.source;
  if (!t || t.ephemeral === true || t.parentThreadId || (source !== 'cli' && source !== 'vscode')) return null;
  return anyThread(t);
}

function anyThread(t: Obj | undefined): CodexThread | null {
  const id = str(t?.id);
  if (!t || !id) return null;
  return {
    id,
    cwd: str(t.cwd),
    title: str(t.name).trim() || str(t.preview).replace(/\s+/g, ' ').trim(),
    path: str(t.path) || null,
    updatedAt: num(t.updatedAt) * 1000,
  };
}

// What `make` makes, kept for KEEP_MS: everyone who asks while it is made waits for the one making; once old it
// is made again in the background while the kept one answers, and kept on when that fails.
function kept<T>(make: () => Promise<T>): () => Promise<T> {
  let had: { at: number; value: T } | null = null;
  let making: Promise<T> | null = null;
  return () => {
    if (!(had && Date.now() - had.at < KEEP_MS) && !making) {
      making = make()
        .then((value) => {
          had = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          making = null;
        });
    }
    if (had) {
      making?.catch(() => {});
      return Promise.resolve(had.value);
    }
    return making!;
  };
}

export class CodexThreads {
  private asking: Promise<CodexOnMac[]> | null = null;
  private readonly locks: string;
  private readonly threads: () => Promise<CodexThread[]>;
  private readonly everyThread: () => Promise<CodexThread[]>;

  constructor(private readonly o: { agent: CodexAgent; sock: string; codexHome: string }) {
    this.locks = join(o.codexHome, 'thread-writer-locks');
    this.threads = kept(async () => (await o.agent.listThreads({ limit: LIMIT, sourceKinds: ['cli', 'vscode'] })).flatMap((d) => threadOf(d) ?? []));
    this.everyThread = kept(async () => {
      const threads: CodexThread[] = [];
      let cursor: string | null = null;
      do {
        const page: { data: unknown[]; next: string | null } = await o.agent.listThreadPage({ limit: ALL_PAGE, sourceKinds: ['cli', 'vscode'], ...(cursor && { cursor }) });
        threads.push(...page.data.flatMap((d) => threadOf(d) ?? []));
        cursor = page.next;
      } while (cursor);
      return threads;
    });
  }

  // The latest threads and every thread open somewhere now, newest first. Asked again while one runs, the one
  // running answers.
  list(): Promise<CodexOnMac[]> {
    this.asking ??= this.listNow().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  // Every thread people opened, however old, newest first, as list() has them.
  async all(): Promise<CodexOnMac[]> {
    const [threads, holders] = await Promise.all([this.everyThread(), this.holders()]);
    const shown = await Promise.all(threads.map((t) => this.live(t, holders.get(t.id) ?? null)));
    return shown.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // One thread as list() has it, also when it is older than the list goes or not one list() shows; null when
  // there is none.
  async where(id: string): Promise<CodexOnMac | null> {
    const listed = (await this.list()).find((t) => t.id === id);
    if (listed) return listed;
    const thread = anyThread(await this.o.agent.readThread(id));
    if (!thread) return null;
    const holders = await this.holders();
    return this.live(thread, holders.get(id) ?? null);
  }

  private async listNow(): Promise<CodexOnMac[]> {
    const [threads, holders] = await Promise.all([this.threads(), this.holders()]);
    const known = new Set(threads.map((t) => t.id));
    // Opened since the list was made: read on its own, which is quick.
    const added = await Promise.all(
      [...holders.keys()].filter((id) => !known.has(id)).map((id) => this.o.agent.readThread(id).then(threadOf, () => null)),
    );
    const all = [...threads, ...added.flatMap((t) => (t ? [t] : []))];
    const shown = await Promise.all(all.map((t) => this.live(t, holders.get(t.id) ?? null)));
    return shown.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // The thread's state as its rollout says now.
  private async live(t: CodexThread, holder: CodexHolder | null): Promise<CodexOnMac> {
    const end = t.path ? await rolloutEnd(t.path).catch(() => null) : null;
    return {
      ...t,
      holder,
      // A turn left unended by a Codex that was quit is not one the Codex holding it now runs.
      busy: holder?.at === 'terminal' && !!end?.busy && end.turnAt >= holder.since,
      lastPrompt: end?.lastPrompt ?? null,
      lastActivity: Math.round(Math.max(t.updatedAt, end?.mtime ?? 0)),
    };
  }

  // Who holds each thread's lock, by thread id.
  private async holders(): Promise<Map<string, CodexHolder>> {
    const out = await run('/usr/sbin/lsof', ['-Fpn', '+d', this.locks]).catch(() => '');
    const held = new Map<string, number>();
    let pid = 0;
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('n') && line.endsWith('.lock') && pid) held.set(basename(line.slice(1), '.lock'), pid);
    }
    if (!held.size) return new Map();
    const procs = await this.processes([...new Set(held.values())]);
    return new Map([...held].flatMap(([id, p]) => {
      const h = procs.get(p);
      return h ? [[id, h] as const] : [];
    }));
  }

  private async processes(pids: number[]): Promise<Map<number, CodexHolder>> {
    const out = await run('/bin/ps', ['-E', '-ww', '-o', 'pid=,tty=,lstart=,command=', '-p', pids.join(',')]).catch(() => '');
    const procs = new Map<number, CodexHolder>();
    for (const line of out.split('\n')) {
      const [, pid, tty, started, command] = /^\s*(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]{8}\s+\d{4})\s(.*)$/.exec(line) ?? [];
      if (!pid) continue;
      procs.set(Number(pid), holderOf({ pid: Number(pid), tty, since: Date.parse(started) || 0, command }, this.o.sock));
    }
    return procs;
  }
}

// Where a process holding a thread's lock has it, by its line in ps (command with its environment after it);
// sock is this server's app server's. since: when the process started, to the second.
export function holderOf(p: { pid: number; tty: string; since: number; command: string }, sock: string): CodexHolder {
  const listen = /\s--listen\s+unix:\/\/(\S+)/.exec(p.command)?.[1];
  // Resolved when asked: the socket may not exist yet when the server starts, and /var is a link.
  if (listen && real(listen) === real(sock)) return { at: 'here' };
  if (/\sapp-server(\s|$)/.test(p.command) || /(^|\s)WORKOFFDESK_SESSION=\S/.test(p.command) || /(^|[\s/])codex\s+exec(\s|$)/.test(p.command)) return { at: 'elsewhere' };
  return { at: 'terminal', pid: p.pid, tty: /^ttys?\d+$/.test(p.tty) ? p.tty : null, since: p.since };
}

const promptOf = (text: string) => [...text.replace(/\s+/g, ' ').trim()].slice(0, PROMPT_MAX).join('') || null;

// How a rollout ends: whether its last turn is still going and when it started, and what the person said last.
export async function rolloutEnd(path: string): Promise<{ busy: boolean; turnAt: number; lastPrompt: string | null; mtime: number }> {
  const fh = await open(path, 'r');
  try {
    const { size, mtimeMs } = await fh.stat();
    const from = Math.max(0, size - TAIL);
    const buf = Buffer.alloc(size - from);
    await fh.read(buf, 0, buf.length, from);
    // A line the part read starts inside is not JSON on its own, so it is passed over below.
    const lines = buf.toString('utf8').split('\n');
    let busy = false;
    let turnAt = 0;
    let lastPrompt: string | null = null;
    for (const line of lines) {
      if (!line.includes('"event_msg"')) continue;
      let e: Obj | undefined;
      let p: Obj | undefined;
      try {
        e = obj(JSON.parse(line));
        p = obj(e?.payload);
      } catch {
        continue;
      }
      const type = str(p?.type);
      if (type === 'task_started') {
        busy = true;
        turnAt = Date.parse(str(e?.timestamp)) || 0;
      }
      else if (type === 'task_complete' || type === 'turn_aborted') busy = false;
      else if (type === 'item_completed' && obj(p?.item)?.type === 'UserMessage') {
        const text = (Array.isArray(obj(p?.item)?.content) ? (obj(p?.item)!.content as unknown[]) : [])
          .map((c) => (obj(c)?.type === 'text' ? str(obj(c)?.text) : ''))
          .join(' ');
        lastPrompt = promptOf(text) ?? lastPrompt;
      }
      // How Codex before September wrote it.
      else if (type === 'user_message') lastPrompt = promptOf(str(p?.message)) ?? lastPrompt;
    }
    return { busy, turnAt, lastPrompt, mtime: mtimeMs };
  } finally {
    await fh.close();
  }
}
