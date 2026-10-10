import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

// What Claude Code's transcript says of the turn it is on, read from its end: whether the turn is over, and
// what Claude still holds in its own queue. A message typed while it works waits there (enqueue) until it is
// taken into the turn under way (remove), starts a turn of its own (dequeue) or is pulled back into the
// prompt to be changed (popAll).

// The end of the transcript read for it: what was typed long before was taken long ago.
const TAIL_BYTES = 256 * 1024;
const INTERRUPTED = '[Request interrupted';
const COMMAND = /<command-name>/;
const COMMAND_OUTPUT = /^<local-command-std(out|err)>/;

type Entry = {
  type?: unknown;
  subtype?: unknown;
  operation?: unknown;
  content?: unknown;
  timestamp?: unknown;
  isMeta?: unknown;
  isApiErrorMessage?: unknown;
  message?: { content?: unknown };
};

// The entries of the lines, but for commands Claude Code ran on its own (/model, /effort): each is written as
// the command and its output, and is no part of any turn. A command whose prompt goes to Claude (/review)
// has no output of its own and stays, as the prompt of its turn.
function entries(lines: string[], wanted: (line: string) => boolean): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    if (!wanted(line)) continue;
    try {
      const e = JSON.parse(line) as Entry;
      if (!e || typeof e !== 'object') continue;
      if (userSays(e, COMMAND_OUTPUT)) {
        const command = out.findLastIndex((x) => userSays(x, COMMAND));
        if (command >= 0) out.splice(command, 1);
        continue;
      }
      out.push(e);
    } catch {
      // a line cut off by the end of what was read, or one being written
    }
  }
  return out;
}

const texts = (content: unknown): string[] =>
  typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.flatMap((b: { type?: unknown; text?: unknown }) => (b?.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
      : [];

const userSays = (e: Entry, text: RegExp) => e.type === 'user' && texts(e.message?.content).some((t) => text.test(t));

// The messages Claude still holds, oldest first, by the queue operations since the last turn began: what
// was held before then was taken by then.
export function heldByClaude(lines: string[]): string[] {
  const held: string[] = [];
  for (const e of entries(lines, (l) => l.includes('"queue-operation"') || l.includes('"user"'))) {
    if (startsTurn(e)) held.length = 0;
    if (e.type !== 'queue-operation') continue;
    if (e.operation === 'enqueue') held.push(typeof e.content === 'string' ? e.content : '');
    else if (e.operation === 'dequeue') held.shift();
    else if (e.operation === 'popAll') held.length = 0;
    else if (e.operation === 'remove') {
      const i = held.indexOf(e.content as string);
      held.splice(i < 0 ? 0 : i, 1);
    }
  }
  return held;
}

// A prompt: what a turn begins with, as against the answer to a call, a note or Esc.
function startsTurn(e: Entry): boolean {
  if (e.type !== 'user' || e.isMeta === true) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.every((b: { type?: unknown }) => b?.type === 'tool_result')) return false;
  return !texts(c).some((t) => t.startsWith(INTERRUPTED));
}

// What an entry says of the turn: that it ended there, that the turn goes on, or nothing.
function said(e: Entry): 'over' | 'going' | null {
  if (e.type === 'system') return e.subtype === 'stop_hook_summary' ? 'over' : null;
  if (e.type === 'queue-operation') return e.operation === 'dequeue' ? 'going' : null;
  if (e.type === 'assistant') return e.isApiErrorMessage === true ? 'over' : 'going';
  if (e.type === 'user') {
    if (e.isMeta === true) return null;
    return texts(e.message?.content).some((t) => t.startsWith(INTERRUPTED)) ? 'over' : 'going';
  }
  return null;
}

// Whether the turn the lines end in is over, and when it ended; null when they hold no turn.
export function lastTurn(lines: string[]): { over: true; at: number } | { over: false } | null {
  const all = entries(lines, () => true);
  for (let i = all.length - 1; i >= 0; i--) {
    const s = said(all[i]);
    if (s === 'going') return { over: false };
    if (s === 'over') {
      const at = typeof all[i].timestamp === 'string' ? Date.parse(all[i].timestamp as string) : NaN;
      return { over: true, at: Number.isFinite(at) ? at : 0 };
    }
  }
  return null;
}

// The end of a transcript on disk, as lines; null when it cannot be read.
export function transcriptTail(path: string): string[] | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    const lines = buf.toString('utf8').split('\n');
    return from > 0 ? lines.slice(1) : lines;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// heldByClaude for a transcript on disk; none when it cannot be read.
export function heldInTranscript(path: string): string[] {
  const lines = transcriptTail(path);
  return lines ? heldByClaude(lines) : [];
}

// lastTurn for a transcript on disk, where a turn that ended with a message still in Claude's own queue goes
// on with it; null when it cannot be read.
export function turnInTranscript(path: string): ReturnType<typeof lastTurn> {
  const lines = transcriptTail(path);
  if (!lines) return null;
  const turn = lastTurn(lines);
  return turn?.over && heldByClaude(lines).length ? { over: false } : turn;
}
