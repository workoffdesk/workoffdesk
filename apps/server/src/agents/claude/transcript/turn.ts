import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { eventOf, unhandled, type TranscriptEvent } from './events.js';

// What Claude Code's transcript says of the turn it is on, read from its end: whether the turn is over, and
// what Claude still holds in its own queue. A message typed while it works waits there (enqueue) until it is
// taken into the turn under way (remove), starts a turn of its own (dequeue) or is pulled back into the
// prompt to be changed (popAll).

// The end of the transcript read for it: what was typed long before was taken long ago.
const TAIL_BYTES = 256 * 1024;

// The events of the lines, but for commands Claude Code ran on its own at the prompt (/model, /effort): each
// is the command and what it printed, and no part of any turn. A command whose prompt goes to Claude (/review)
// prints nothing of its own and stays, as the prompt of its turn.
function events(lines: string[], wanted: (line: string) => boolean): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const line of lines) {
    if (!wanted(line)) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue; // a line cut off by the end of what was read, or one being written
    }
    const e = eventOf(v);
    if (e.k === 'commandOutput' && !e.local) {
      const command = out.findLastIndex((x) => x.k === 'command' && !x.local);
      if (command >= 0) out.splice(command, 1);
      continue;
    }
    out.push(e);
  }
  return out;
}

// What an event says of the turn: that one begins with it, that it goes on, that it ended there, or nothing.
function turnSays(e: TranscriptEvent): 'starts' | 'going' | 'over' | null {
  switch (e.k) {
    case 'prompt':
    case 'shell':
    case 'shellOutput':
    case 'teammates':
    case 'taskNotification':
    case 'fromOther':
      return 'starts';
    case 'command':
      return e.local ? null : 'starts';
    case 'results':
    case 'reply':
      return 'going';
    case 'queue':
      return e.op === 'dequeue' ? 'going' : null;
    case 'interrupted':
    case 'apiError':
    case 'turnOver':
      return 'over';
    // A compaction asked for runs between turns; one Claude Code starts on its own can fall in the middle of one.
    case 'compactBoundary':
      return e.manual ? 'over' : null;
    case 'commandOutput':
    case 'compacted':
    case 'noted':
    case 'peer':
    case 'midTurnPrompt':
    case 'midTurnTaskEnd':
    case 'title':
    case 'lastPrompt':
    case 'sidechain':
    case 'other':
      return null;
    default:
      return unhandled(e);
  }
}

// The messages Claude still holds, oldest first, by the queue operations since the last turn began: what
// was held before then was taken by then.
export function heldByClaude(lines: string[]): string[] {
  const held: string[] = [];
  for (const e of events(lines, (l) => l.includes('"queue-operation"') || l.includes('"user"'))) {
    if (turnSays(e) === 'starts') held.length = 0;
    if (e.k !== 'queue') continue;
    if (e.op === 'enqueue') held.push(e.text ?? '');
    else if (e.op === 'dequeue') held.shift();
    else if (e.op === 'popAll') held.length = 0;
    else {
      const i = e.text === undefined ? -1 : held.indexOf(e.text);
      held.splice(i < 0 ? 0 : i, 1);
    }
  }
  return held;
}

// Whether the turn the lines end in is over, and when it ended; null when they hold no turn.
export function lastTurn(lines: string[]): { over: true; at: number } | { over: false } | null {
  const all = events(lines, () => true);
  for (let i = all.length - 1; i >= 0; i--) {
    const s = turnSays(all[i]);
    if (s === 'starts' || s === 'going') return { over: false };
    if (s === 'over') {
      const at = Date.parse(all[i].at ?? '');
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

// The messages pulled back out of Claude's queue into its prompt at the Mac, each with when: from there they are
// the person's to change, send or drop, so none of them goes on as it was sent.
function pulledBack(lines: string[]): { text: string; at: number }[] {
  return events(lines, (l) => l.includes('"popAll"')).flatMap((e) =>
    e.k === 'queue' && e.op === 'popAll' && e.text !== undefined ? [{ text: e.text, at: Date.parse(String(e.at)) }] : [],
  );
}

// heldByClaude for a transcript on disk; none when it cannot be read.
export function heldInTranscript(path: string): string[] {
  const lines = transcriptTail(path);
  return lines ? heldByClaude(lines) : [];
}

// Claude's queue in a transcript on disk: what it holds, and what was pulled back out of it.
export function queueInTranscript(path: string): { held: string[]; pulled: ReturnType<typeof pulledBack> } {
  const lines = transcriptTail(path) ?? [];
  return { held: heldByClaude(lines), pulled: pulledBack(lines) };
}

// lastTurn for a transcript on disk, where a turn that ended with a message still in Claude's own queue goes
// on with it; null when it cannot be read.
export function turnInTranscript(path: string): ReturnType<typeof lastTurn> {
  const lines = transcriptTail(path);
  if (!lines) return null;
  const turn = lastTurn(lines);
  return turn?.over && heldByClaude(lines).length ? { over: false } : turn;
}
