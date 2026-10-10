import { watch, type FSWatcher } from 'node:fs';
import { findTranscript } from './transcriptFile.js';

// A transcript that is not there yet is looked for this often; a new session writes it with its first message.
const FIND_MS = 1000;
// Changes this close together are told once: a reply is often several writes in a row.
const SETTLE_MS = 100;

// Calls `changed` whenever the session's transcript is written to, from when it first appears; the function
// returned stops it. A transcript replaced by a new file (renamed over) is found again, and so is the new
// one when the session moves to another conversation (`sessionId` is asked again each time).
export function watchTranscript(root: string, sessionId: () => string | undefined, changed: () => void): () => void {
  let stopped = false;
  let watcher: FSWatcher | null = null;
  let watching: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  let settle: NodeJS.Timeout | undefined;
  const moved = setInterval(() => watcher && sessionId() !== watching && again(), FIND_MS);

  const tell = () => {
    clearTimeout(settle);
    settle = setTimeout(() => !stopped && changed(), SETTLE_MS);
  };
  const find = async () => {
    const sid = sessionId();
    const path = sid ? await findTranscript(root, sid).catch(() => null) : null;
    if (stopped) return;
    if (!path) {
      timer = setTimeout(find, FIND_MS);
      return;
    }
    try {
      watcher = watch(path, (event) => {
        tell();
        if (event === 'rename') again();
      });
      watcher.on('error', again);
      watching = sid;
    } catch {
      timer = setTimeout(find, FIND_MS);
      return;
    }
    tell();
  };
  const again = () => {
    watcher?.close();
    watcher = null;
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(find, FIND_MS);
  };
  void find();
  return () => {
    stopped = true;
    clearInterval(moved);
    clearTimeout(timer);
    clearTimeout(settle);
    watcher?.close();
  };
}
