import { open, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { envelopeOf, eventOf, type ClaudeEvent, type TranscriptRecord } from './events.js';
import { unhandled } from '../../events.js';
import { findTranscript } from './transcriptFile.js';

// Claude Code's transcript format is undocumented: every field read here is
// optional, and a file that yields nothing parseable is skipped, never thrown.

// `automated`: started through the SDK by a program (an agent runner such as Paperclip), not by a person.
// lastPrompt: what the person said last, which tells the conversation apart better than a title Claude
// gave it from the first words.
export type RecentClaudeSession = { sessionId: string; cwd: string | null; title: string; lastPrompt: string | null; lastActivity: number; automated: boolean };

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const TITLE_MAX = 60;
const LAST_PROMPT_MAX = 200;

// Up to `limit` of the latest sessions people started, and as many of those programs started, newest
// first: a busy agent runner does not push a person's sessions off the list.
// Asked for again while a listing runs (several pages and phones open at once), the one running answers.
const running = new Map<string, Promise<RecentClaudeSession[]>>();

export function listRecentClaudeSessions(root: string, limit = 50): Promise<RecentClaudeSession[]> {
  const key = `${limit}:${root}`;
  const now = running.get(key);
  if (now) return now;
  const next = listRecent(root, limit).finally(() => running.delete(key));
  running.set(key, next);
  return next;
}

async function listRecent(root: string, limit: number): Promise<RecentClaudeSession[]> {
  const files = await transcriptFiles(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = { people: [] as RecentClaudeSession[], programs: [] as RecentClaudeSession[] };
  // Nothing was said in a file after it was last written, so once a file was written before the limit-th
  // latest message of each kind, no file after it can be among them.
  const latest = (list: RecentClaudeSession[]) => (list.length < limit ? -Infinity : list[limit - 1].lastActivity);
  for (const f of files.slice(0, limit * 6)) {
    if (f.mtimeMs < latest(kept.people) && f.mtimeMs < latest(kept.programs)) break;
    const r = await rowOf(f);
    if (!r || isScratch(r.cwd)) continue;
    const list = kept[r.automated ? 'programs' : 'people'];
    list.push(r);
    list.sort((a, b) => b.lastActivity - a.lastActivity);
    list.splice(limit);
  }
  return [...kept.people, ...kept.programs].sort((a, b) => b.lastActivity - a.lastActivity);
}

// Every conversation Claude Code still keeps, newest first, programs' too. Asked again while a listing runs, the
// one running answers.
let listingAll: Promise<RecentClaudeSession[]> | null = null;

export function listAllClaudeSessions(root: string): Promise<RecentClaudeSession[]> {
  listingAll ??= listAll(root).finally(() => {
    listingAll = null;
  });
  return listingAll;
}

async function listAll(root: string): Promise<RecentClaudeSession[]> {
  const all: RecentClaudeSession[] = [];
  for (const f of await transcriptFiles(root)) {
    const r = await rowOf(f);
    if (r && !isScratch(r.cwd)) all.push(r);
  }
  return all.sort((a, b) => b.lastActivity - a.lastActivity);
}

// One conversation Claude Code still keeps, as the lists have it, however old; null when it keeps none by that id.
export async function oneClaudeSession(root: string, sessionId: string): Promise<RecentClaudeSession | null> {
  const path = await findTranscript(root, sessionId);
  const st = path ? await stat(path).catch(() => null) : null;
  return path && st ? rowOf({ path, size: st.size, mtimeMs: st.mtimeMs }) : null;
}

async function rowOf(f: { path: string; size: number; mtimeMs: number }): Promise<RecentClaudeSession | null> {
  const parsed = await parsedOnce(f);
  if (!parsed) return null;
  const { saidAt, ...shown } = parsed;
  return { sessionId: basename(f.path, '.jsonl'), ...shown, lastActivity: saidAt ?? Math.round(f.mtimeMs) };
}

// A conversation in a temporary folder is a throwaway run (a test, a probe), not work to come back to.
const SCRATCH_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/', join(tmpdir(), '/')];

function isScratch(cwd: string | null): boolean {
  return cwd !== null && SCRATCH_ROOTS.some((r) => cwd.startsWith(r));
}

export function listProjectDirs(recent: RecentClaudeSession[], pinned: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...pinned, ...recent.map((r) => r.cwd)]) {
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

async function transcriptFiles(root: string) {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: { path: string; mtimeMs: number; size: number }[] = [];
  for (const d of dirs) {
    let names: string[];
    try {
      names = await readdir(join(root, d));
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const p = join(root, d, n);
      try {
        const s = await stat(p);
        if (s.isFile()) files.push({ path: p, mtimeMs: s.mtimeMs, size: s.size });
      } catch {
        // vanished between readdir and stat
      }
    }
  }
  return files;
}

// What a transcript was read as, kept while the file stays as it was: the list is asked for often, and
// reading the head and tail of hundreds of files each time took seconds.
const parsedCache = new Map<string, { size: number; mtimeMs: number; parsed: Awaited<ReturnType<typeof parseTranscript>> }>();
const PARSED_KEPT = 20_000;

async function parsedOnce(f: { path: string; size: number; mtimeMs: number }) {
  const kept = parsedCache.get(f.path);
  if (kept && kept.size === f.size && kept.mtimeMs === f.mtimeMs) return kept.parsed;
  const parsed = await parseTranscript(f.path, f.size).catch(() => null);
  parsedCache.delete(f.path);
  parsedCache.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, parsed });
  for (const old of parsedCache.keys()) {
    if (parsedCache.size <= PARSED_KEPT) break;
    parsedCache.delete(old);
  }
  return parsed;
}

// saidAt: when the last message was said, by the person or Claude; null when no message carries a time.
async function parseTranscript(path: string, size: number): Promise<(Omit<RecentClaudeSession, 'sessionId' | 'lastActivity'> & { saidAt: number | null }) | null> {
  const records = await readRecords(path, size);
  if (!records.length) return null;
  const cwds: string[] = [];
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let firstPrompt: string | null = null;
  let lastPrompt: string | null = null;
  let automated = false;
  let saidAt: number | null = null;
  for (const r of records) {
    const e = eventOf(r);
    const envelope = envelopeOf(r);
    if (envelope.cwd) cwds.push(envelope.cwd);
    if (envelope.automated) automated = true;
    if (e.at && isSaid(e)) {
      const at = Date.parse(e.at);
      if (Number.isFinite(at) && at > (saidAt ?? -Infinity)) saidAt = at;
    }
    if (e.k === 'claude:title' && e.text.trim()) {
      if (e.by === 'person') customTitle = truncate(e.text.replace(/\s+/g, ' ').trim());
      else aiTitle = e.text.trim();
    }
    const said = e.k === 'claude:prompt' ? promptText(e.words) : e.k === 'claude:lastPrompt' ? promptText(e.text) : null;
    if (said) lastPrompt = said;
    if (!firstPrompt && e.k === 'claude:prompt') firstPrompt = said;
  }
  const title = customTitle ?? aiTitle ?? (firstPrompt ? truncate(firstPrompt) : basename(path, '.jsonl').slice(0, 8));
  return { cwd: conversationFolder(cwds), title, lastPrompt: lastPrompt && truncate(lastPrompt, LAST_PROMPT_MAX), automated, saidAt };
}

// Whether an event is something said, by the person or Claude, rather than a note or a record of Claude Code's.
function isSaid(e: ClaudeEvent): boolean {
  switch (e.k) {
    case 'claude:prompt':
    case 'claude:shell':
    case 'claude:shellOutput':
    case 'claude:results':
    case 'claude:interrupted':
    case 'claude:compacted':
    case 'claude:teammates':
    case 'claude:taskNotification':
    case 'claude:fromOther':
    case 'claude:reply':
    case 'claude:apiError':
      return true;
    case 'claude:command':
    case 'claude:commandOutput':
      return !e.local;
    case 'claude:noted':
    case 'claude:peer':
    case 'claude:compactBoundary':
    case 'claude:turnOver':
    case 'claude:queue':
    case 'claude:midTurnPrompt':
    case 'claude:midTurnTaskEnd':
    case 'claude:title':
    case 'claude:lastPrompt':
    case 'claude:sidechain':
    case 'claude:other':
      return false;
    default:
      return unhandled(e);
  }
}

// The folder a conversation last ran in, from the folders its records were written in, oldest first. Within a
// run each is the run's folder or one inside it (a cd); one that is neither starts an earlier run elsewhere.
function conversationFolder(cwds: string[]): string | null {
  let folder: string | null = null;
  for (const cwd of cwds.toReversed()) {
    if (folder === null || within(folder, cwd)) folder = cwd;
    else if (!within(cwd, folder)) break;
  }
  return folder;
}

const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith('/') ? outer : `${outer}/`);

async function readRecords(path: string, size: number): Promise<TranscriptRecord[]> {
  const fh = await open(path, 'r');
  try {
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      return parseLines((await fh.readFile()).toString('utf8'));
    }
    const head = Buffer.alloc(HEAD_BYTES);
    await fh.read(head, 0, HEAD_BYTES, 0);
    const tail = Buffer.alloc(TAIL_BYTES);
    await fh.read(tail, 0, TAIL_BYTES, size - TAIL_BYTES);
    return [...parseLines(head.toString('utf8')), ...parseLines(tail.toString('utf8'))];
  } finally {
    await fh.close();
  }
}

// A line cut by the head/tail window is never valid JSON on its own, so the
// parse below discards it without special handling.
function parseLines(text: string): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  for (const l of text.split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      const v = JSON.parse(l);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      // partial or foreign line
    }
  }
  return out;
}

function promptText(raw: string): string | null {
  // An agent runner's wake names its issue on a line of its own; that, not its template, says what it is.
  const issue = /^- issue:\s*(.+)$/m.exec(raw)?.[1];
  const text = (issue ?? raw.replace(/^#{1,6}\s+/gm, '')).replace(/\s+/g, ' ').trim();
  return text && !text.startsWith('<') ? text : null;
}

function truncate(s: string, max = TITLE_MAX): string {
  return [...s].slice(0, max).join('');
}

// The conversations Claude Code's background sessions hold (~/.claude/jobs: a folder per session, named by
// the first eight characters of its conversation, its state.json naming the transcript it follows). One
// held there must not also be resumed here: two Claudes would write the same conversation.
export async function heldInBackground(jobsRoot: string): Promise<(sessionId: string) => boolean> {
  let names: string[];
  try {
    names = await readdir(jobsRoot);
  } catch {
    return () => false;
  }
  const followed = new Set<string>();
  const named = new Set<string>();
  for (const name of names) {
    let state: unknown;
    try {
      state = JSON.parse(await readFile(join(jobsRoot, name, 'state.json'), 'utf8'));
    } catch {
      continue;
    }
    named.add(name);
    const path = state && typeof state === 'object' ? (state as { linkScanPath?: unknown }).linkScanPath : undefined;
    if (typeof path === 'string') followed.add(basename(path, '.jsonl'));
  }
  return (sessionId) => followed.has(sessionId) || named.has(sessionId.slice(0, 8));
}
