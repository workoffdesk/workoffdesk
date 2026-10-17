import { readdir, readFile, open, stat, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chatItems, type ChatItem } from './chat.js';

// A session's transcript file read for the chat: from where the phone's copy ends, back from where it
// starts, its last reply, and where it is.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_READ = 4 * 1024 * 1024;
// About a screenful of turns many times over, little enough to come at once on a slow phone.
const PAGE_TURNS = 100;
const CHUNK = 256 * 1024;

// sidechain: the file is a sub-agent's, whose records are all marked as not its parent's, and are its own here.
function lineItems(l: string, sidechain = false): ChatItem[] {
  try {
    const r: unknown = JSON.parse(l);
    return chatItems(sidechain && r && typeof r === 'object' ? { ...r, isSidechain: false } : r);
  } catch {
    return [];
  }
}

export type IdItem = { id: string; item: ChatItem };

// Each item of a transcript line under a name that stays the same however the file is read: the line's
// uuid and the item's place in it; a line without one is named by where it starts.
export function idItems(line: string, at: number): IdItem[] {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return [];
  }
  const uuid = v && typeof v === 'object' && typeof (v as { uuid?: unknown }).uuid === 'string' ? (v as { uuid: string }).uuid : `b${at}`;
  return chatItems(v).map((item, n) => ({ id: `${uuid}:${n}`, item }));
}

// The whole lines from byte `from`, each with where it starts, up to maxRead bytes, and where the next
// read starts. A line still being written is left for the next read.
export async function linesFrom(path: string, from: number, maxRead = MAX_READ): Promise<{ lines: { at: number; line: string }[]; next: number; size: number }> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    if (from >= size) return { lines: [], next: Math.min(from, size), size };
    let buf = Buffer.alloc(0);
    let end = 0;
    // A line longer than maxRead (a picture pasted into the prompt) is read whole on its own.
    for (let want = maxRead; !end && buf.length < size - from; want *= 2) {
      buf = Buffer.alloc(Math.min(size - from, want));
      await fh.read(buf, 0, buf.length, from);
      end = buf.lastIndexOf(0x0a) + 1;
    }
    const lines: { at: number; line: string }[] = [];
    for (let s = 0; s < end; ) {
      const e = buf.indexOf(0x0a, s);
      if (e > s) lines.push({ at: from + s, line: buf.subarray(s, e).toString('utf8') });
      s = e + 1;
    }
    return { lines, next: from + end, size };
  } finally {
    await fh.close();
  }
}

// The items added to the transcript since byte `from`, where reading really started (not `from` when it
// started over: what was read before is void), and where the next read starts. Only whole lines are
// taken; one still being written is read next time. A first read, and one further behind than a read takes,
// opens on the last turns (skipped: older ones were left out).
export async function readChat(
  path: string,
  from: number,
  o: { maxRead?: number; turns?: number; sidechain?: boolean } = {},
): Promise<{ items: ChatItem[]; from: number; next: number; skipped: boolean }> {
  const size = (await stat(path)).size;
  const maxRead = o.maxRead ?? MAX_READ;
  if (from === 0 || from > size || size - from > maxRead) return readChatBefore(path, size, { turns: o.turns, sidechain: o.sidechain });
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(size - from);
    await fh.read(buf, 0, buf.length, from);
    const end = buf.lastIndexOf(0x0a) + 1;
    const items = buf
      .subarray(0, end)
      .toString('utf8')
      .split('\n')
      .flatMap((l) => lineItems(l, o.sidechain));
    return { items, from, next: from + end, skipped: false };
  } finally {
    await fh.close();
  }
}

// The whole lines before byte `end`, newest first, with where each starts. A line cut off at `end`, still
// being written, is not one of them.
async function* linesBefore(fh: FileHandle, end: number, chunk: number) {
  let pos = end;
  let rest = Buffer.alloc(0);
  let whole = false;
  for (;;) {
    if (pos > 0) {
      const n = Math.min(chunk, pos);
      pos -= n;
      const piece = Buffer.alloc(n);
      await fh.read(piece, 0, n, pos);
      rest = Buffer.concat([piece, rest]);
    }
    if (!whole) {
      const nl = rest.lastIndexOf(0x0a);
      if (nl < 0) {
        if (pos > 0) continue;
        return;
      }
      rest = rest.subarray(0, nl + 1);
      whole = true;
    }
    // rest ends with the newline of the newest line not given yet.
    let e = rest.length - 1;
    while (e >= 0) {
      const p = e > 0 ? rest.lastIndexOf(0x0a, e - 1) : -1;
      if (p < 0 && pos > 0) break;
      yield { start: pos + p + 1, line: rest.subarray(p + 1, e) };
      e = p;
    }
    if (e < 0) return;
    rest = rest.subarray(0, e + 1);
  }
}

// The last turns before byte `before`, which is where the caller's copy starts: from is where they
// start, next where they end. Reading stops at a budget, to answer quickly however far apart the
// turns are, but always goes back at least one line. A file shorter than `before` is read from its end.
export async function readChatBefore(
  path: string,
  before: number,
  o: { turns?: number; maxRead?: number; chunk?: number; sidechain?: boolean } = {},
): Promise<{ items: ChatItem[]; from: number; next: number; skipped: boolean }> {
  const turns = o.turns ?? PAGE_TURNS;
  const maxRead = o.maxRead ?? MAX_READ;
  const fh = await open(path, 'r');
  try {
    const end = Math.min(before, (await fh.stat()).size);
    const taken: ChatItem[][] = [];
    let count = 0;
    let next: number | undefined;
    let from: number | undefined;
    for await (const { start, line } of linesBefore(fh, end, o.chunk ?? CHUNK)) {
      next ??= start + line.length + 1;
      if (count >= turns || (from !== undefined && next - start > maxRead)) break;
      const items = lineItems(line.toString('utf8'), o.sidechain);
      taken.push(items);
      count += items.filter((i) => i.k !== 'result').length;
      from = start;
    }
    from ??= next ?? 0;
    return { items: taken.reverse().flat(), from, next: next ?? from, skipped: from > 0 };
  } finally {
    await fh.close();
  }
}

const REPLY_TAIL = 256 * 1024;
const REPLY_CHARS = 120;

// What a list shows of a conversation, from the end of its transcript. reply: what Claude said last, or the
// error its turn ended in, as a line of plain words (the Markdown it writes in is dropped). at: when the last
// thing in it happened. Each null when nothing is there.
export async function lastSaid(path: string, tail = REPLY_TAIL): Promise<{ reply: string | null; at: number | null }> {
  const size = (await stat(path)).size;
  const { items } = await readChat(path, Math.max(0, size - tail));
  const dated = items.findLast((i) => 'at' in i && i.at);
  const at = dated && 'at' in dated && dated.at ? Date.parse(dated.at) : NaN;
  return { reply: replyOf(items), at: Number.isFinite(at) ? at : null };
}

function replyOf(items: ChatItem[]): string | null {
  const last = items.findLast((i) => i.k === 'text' || (i.k === 'note' && 'event' in i && i.event.e === 'failed'));
  if (!last) return null;
  // A turn that ended in an error says so, in Claude Code's own words.
  if (last.k === 'note') return [...`API Error: ${last.detail ?? ''}`.trim()].slice(0, REPLY_CHARS).join('');
  if (last.k !== 'text') return null;
  const plain = last.text
    .replace(/^```.*$/gm, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? [...plain].slice(0, REPLY_CHARS).join('') : null;
}

// Where Claude Code keeps the transcript of a session: <root>/<project folder>/<session id>.jsonl.
export async function findTranscript(root: string, sessionId: string): Promise<string | null> {
  if (!UUID.test(sessionId)) return null;
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const p = join(root, d, `${sessionId}.jsonl`);
    try {
      if ((await stat(p)).isFile()) return p;
    } catch {
      // not in this folder
    }
  }
  return null;
}

// A sub-agent a conversation started, by the id of the call that started it: its transcript, beside
// <session id>/subagents/agent-<id>.meta.json, which names the call, under the conversation's own folder.
export async function findSubagent(root: string, sessionId: string, toolUseId: string): Promise<{ path: string; description: string } | null> {
  const parent = await findTranscript(root, sessionId);
  if (!parent) return null;
  const dir = join(dirname(parent), sessionId, 'subagents');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const n of names.filter((n) => /^agent-[A-Za-z0-9]+\.meta\.json$/.test(n))) {
    try {
      const meta: unknown = JSON.parse(await readFile(join(dir, n), 'utf8'));
      if (!meta || typeof meta !== 'object' || (meta as { toolUseId?: unknown }).toolUseId !== toolUseId) continue;
      const description = (meta as { description?: unknown }).description;
      return { path: join(dir, n.replace(/\.meta\.json$/, '.jsonl')), description: typeof description === 'string' ? description : '' };
    } catch {
      // being written, or not a sub-agent's
    }
  }
  return null;
}
