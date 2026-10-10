import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { Conflict, InvalidRequest } from '../system/errors.js';
import { pruneOld, stamp } from './media.js';

const run = promisify(execFile);

// A file from the phone (a video, a document) comes in parts, each appended where the Mac's copy ends, so a
// line that drops picks up from there. What it is does not matter: it is kept as it came, under its own name.
export const PART_MAX = 8 * 1024 * 1024;
const FILE_MAX = 4 * 1024 * 1024 * 1024;
const ID = /^[a-z0-9]{16,40}$/;
// Where a file waits while it comes, and what became of one that is whole, for a finish asked again.
const PARTS = '.parts';
const PART_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
// A video is also given as stills, which Claude can look at: this many at most, at least a second apart.
const FRAMES_AT_MOST = 30;
const FRAMES_AT_ONCE = 4;
const FRAME_WIDTH = 1280;
const PROBE_MS = 15_000;
const NAME_MAX = 120;

export type Frames = { dir: string; count: number; every: number };
export type FileSent = { path: string; frames: Frames | null };

// One write at a time for each file, so a part sent again while the first is still being written cannot
// land twice.
const busy = new Map<string, Promise<unknown>>();
function inTurn<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (busy.get(id) ?? Promise.resolve()).then(work, work);
  const settled = next.catch(() => {});
  busy.set(id, settled);
  void settled.then(() => busy.get(id) === settled && busy.delete(id));
  return next;
}

function partOf(dir: string, id: string): string {
  if (!ID.test(id)) throw new InvalidRequest('bad upload id');
  return join(dir, PARTS, id);
}

const sizeOf = (file: string) => stat(file).then((s) => s.size, () => 0);

// How much of the file the Mac has.
export const partSize = (dir: string, id: string): Promise<number> => sizeOf(partOf(dir, id));

// Adds bytes where the Mac's copy ends; `at` is where the phone thinks that is. The size after.
export function appendPart(dir: string, id: string, at: number, bytes: Buffer): Promise<number> {
  const file = partOf(dir, id);
  return inTurn(id, async () => {
    const size = await sizeOf(file);
    if (at !== size) throw new Conflict(`the Mac has ${size} bytes of this file`, 'upload-offset');
    if (size + bytes.length > FILE_MAX) throw new InvalidRequest('the file is too large');
    await mkdir(join(dir, PARTS), { recursive: true, mode: 0o700 });
    await appendFile(file, bytes, { mode: 0o600 });
    return size + bytes.length;
  });
}

// What is safe as a file name: one path segment, no quotes (the path is quoted to Claude), no control
// characters, not too long.
export function fileName(name: string): string {
  const clean = [...name.replace(/[/\\"\p{Cc}]+/gu, '_').trim()].slice(-NAME_MAX).join('');
  return clean && clean !== '.' && clean !== '..' && !clean.startsWith('.') ? clean : `file${clean}`;
}

// Moves a whole file to a folder of its own under its own name and returns its path, with stills when it is
// a video. Asked again, it answers the same.
export function finishPart(dir: string, id: string, name: string, size: number): Promise<FileSent> {
  const file = partOf(dir, id);
  const record = `${file}.json`;
  return inTurn(id, async () => {
    const done = await readFile(record, 'utf8').then((r) => JSON.parse(r) as FileSent, () => null);
    if (done) return done;
    const have = await sizeOf(file);
    if (have !== size) throw new Conflict(`the Mac has ${have} of ${size} bytes`, 'upload-incomplete');
    // An empty file never had a part to start it.
    if (!size) await mkdir(join(dir, PARTS), { recursive: true, mode: 0o700 }).then(() => writeFile(file, '', { mode: 0o600, flag: 'a' }));
    await pruneOld(dir);
    await pruneParts(dir);
    const home = join(dir, `${stamp(new Date())}-${randomBytes(3).toString('hex')}`);
    await mkdir(home, { mode: 0o700 });
    const path = join(home, fileName(name));
    await rename(file, path);
    await chmod(path, 0o600);
    const sent: FileSent = { path, frames: await videoFrames(path, join(home, 'frames')) };
    await writeFile(record, JSON.stringify(sent), { mode: 0o600 });
    return sent;
  });
}

async function pruneParts(dir: string) {
  const parts = join(dir, PARTS);
  const cutoff = Date.now() - PART_MAX_AGE_MS;
  for (const name of await readdir(parts).catch(() => [])) {
    const file = join(parts, name);
    const at = (await stat(file).catch(() => null))?.mtimeMs ?? Infinity;
    if (at < cutoff) await rm(file, { force: true });
  }
}

// Stills spread over a video, named by when they are (at-01m05s.jpg); null for what is not a video, or when
// ffmpeg is not there.
async function videoFrames(file: string, out: string): Promise<Frames | null> {
  let seconds: number;
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], {
      timeout: PROBE_MS,
    });
    const info = JSON.parse(stdout) as { streams?: unknown[]; format?: { duration?: string } };
    seconds = Number(info.format?.duration);
    if (!info.streams?.length || !(seconds >= 1)) return null;
  } catch {
    return null;
  }
  const every = Math.max(1, Math.ceil(seconds / FRAMES_AT_MOST));
  const times: number[] = [];
  for (let at = 0; at < seconds; at += every) times.push(at);
  await mkdir(out, { mode: 0o700 });
  let count = 0;
  const still = async (at: number) => {
    const name = `at-${String(Math.floor(at / 60)).padStart(2, '0')}m${String(at % 60).padStart(2, '0')}s.jpg`;
    await run('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`, '-q:v', '4', join(out, name)], {
      timeout: PROBE_MS,
    }).then(
      () => count++,
      () => {},
    );
  };
  for (let i = 0; i < times.length; i += FRAMES_AT_ONCE) await Promise.all(times.slice(i, i + FRAMES_AT_ONCE).map(still));
  if (!count) {
    await rm(out, { recursive: true, force: true });
    return null;
  }
  return { dir: out, count, every };
}

// A file's folder in uploads, as finishPart names it.
const FOLDER = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}$/;
const FRAMES = 'frames';

function folderOf(dir: string, folder: string): string {
  if (!FOLDER.test(folder)) throw new InvalidRequest('bad folder');
  return join(dir, folder);
}

// The first still of a video, which stands for it where it is shown; null for what has none.
export async function videoCover(dir: string, folder: string): Promise<Buffer | null> {
  const frames = join(folderOf(dir, folder), FRAMES);
  const first = (await readdir(frames).catch(() => [])).filter((n) => n.endsWith('.jpg')).sort()[0];
  return first ? readFile(join(frames, first)) : null;
}

// The file a folder was made for: the one thing in it besides the stills.
async function keptFile(dir: string, folder: string): Promise<string | null> {
  const home = folderOf(dir, folder);
  const name = (await readdir(home).catch(() => [])).find((n) => n !== FRAMES);
  return name ? join(home, name) : null;
}

// A video as it is played: the file, what it is, and how large.
export type Playable = { file: string; type: string; size: number };

const VIDEO_TYPES: Record<string, string> = { '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.m4v': 'video/mp4' };

export async function videoFile(dir: string, folder: string): Promise<Playable | null> {
  const file = await keptFile(dir, folder);
  if (!file) return null;
  const size = await stat(file).then((s) => s.size, () => null);
  return size === null ? null : { file, type: VIDEO_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', size };
}

// The bytes a Range header asks for, as a video player asks for them; null for the whole file, and
// 'unsatisfiable' for a range outside it.
export function byteRange(range: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : 'unsatisfiable';
}
