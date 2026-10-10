import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { UnsupportedMedia } from '../system/errors.js';

const run = promisify(execFile);

export class NotAnImage extends UnsupportedMedia {}

type ImageKind = 'png' | 'jpg' | 'gif' | 'webp' | 'heic';
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
]);
const UPLOAD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Judged by the bytes, never by what the client says the file is.
export function imageKind(b: Buffer): ImageKind | null {
  const ascii = (from: number, to: number) =>
    b.subarray(from, to).toString('latin1');
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'heic';
  return null;
}

export const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export async function pruneOld(dir: string) {
  const cutoff = Date.now() - UPLOAD_MAX_AGE_MS;
  for (const name of await readdir(dir).catch(() => [])) {
    const file = join(dir, name);
    if (name !== '.parts' && ((await stat(file).catch(() => null))?.mtimeMs ?? Infinity) < cutoff) await rm(file, { recursive: true, force: true });
  }
}

// The name saveImage gives an upload; nothing else is ever read back.
const UPLOAD_NAME = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.(png|jpg|gif|webp)$/;
const MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
};

// An upload to show back on the phone, typed by its bytes; null for any other name or for what is not an image.
export async function readUpload(
  dir: string,
  name: string
): Promise<{ bytes: Buffer; type: string } | null> {
  if (!UPLOAD_NAME.test(name)) return null;
  const bytes = await readFile(join(dir, name)).catch(() => null);
  const kind = bytes && imageKind(bytes);
  return kind ? { bytes: bytes!, type: MIME[kind] } : null;
}

// Saves an image sent from the phone and returns its path, for Claude to be pointed at.
// iPhone photos can be HEIC, which Claude cannot read; those are kept as JPEG.
export async function saveImage(dir: string, bytes: Buffer): Promise<string> {
  const kind = imageKind(bytes);
  if (!kind) throw new NotAnImage('only images can be uploaded (PNG, JPEG, GIF, WebP, HEIC)', 'not-an-image');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await pruneOld(dir);
  const base = join(
    dir,
    `${stamp(new Date())}-${randomBytes(3).toString('hex')}`
  );
  if (kind !== 'heic') {
    await writeFile(`${base}.${kind}`, bytes, { mode: 0o600, flag: 'wx' });
    return `${base}.${kind}`;
  }
  const work = await mkdtemp(join(tmpdir(), 'workoffdesk-heic-'));
  try {
    const src = join(work, 'in.heic');
    await writeFile(src, bytes, { mode: 0o600 });
    await run('sips', ['-s', 'format', 'jpeg', src, '--out', `${base}.jpg`]);
    await chmod(`${base}.jpg`, 0o600);
    return `${base}.jpg`;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const NAMED_IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const NAMED_IMAGE_MAX = 20 * 1024 * 1024;
const SEARCH_CHUNK = 1024 * 1024;

// Whether a transcript holds `text` as it is written into JSON, read a piece at a time.
async function mentions(transcript: string, text: string, chunk: number): Promise<boolean> {
  const needle = Buffer.from(JSON.stringify(text).slice(1, -1));
  const file = await open(transcript, 'r').catch(() => null);
  if (!file) return false;
  try {
    const buf = Buffer.alloc(chunk + needle.length);
    let kept = 0;
    for (;;) {
      const { bytesRead } = await file.read(buf, kept, chunk, null);
      if (!bytesRead) return false;
      const end = kept + bytesRead;
      if (buf.subarray(0, end).includes(needle)) return true;
      kept = Math.min(needle.length - 1, end);
      buf.copy(buf, 0, end - kept, end);
    }
  } finally {
    await file.close();
  }
}

// An image Claude named in a session (in what it said, or a file it read), to show in the chat. Only a
// path written as such in the session's transcript is read, and only what is an image both by the name it
// has once links are followed and by its bytes.
export async function readMentionedImage(
  transcript: string,
  path: string,
  opts: { home?: string; chunk?: number; maxBytes?: number } = {}
): Promise<{ bytes: Buffer; type: string } | 'gone' | 'refused'> {
  const absolute = path.startsWith('~/') ? join(opts.home ?? homedir(), path.slice(2)) : path;
  if (!absolute.startsWith('/')) return 'refused';
  if (!(await mentions(transcript, path, opts.chunk ?? SEARCH_CHUNK))) return 'refused';
  const real = await realpath(absolute).catch((e) => (e?.code === 'ENOENT' ? null : undefined));
  if (real === null) return 'gone';
  if (!real || !NAMED_IMAGE.test(real)) return 'refused';
  const info = await stat(real);
  if (!info.isFile() || info.size > (opts.maxBytes ?? NAMED_IMAGE_MAX)) return 'refused';
  const bytes = await readFile(real);
  const kind = imageKind(bytes);
  return kind ? { bytes, type: MIME[kind] } : 'refused';
}
