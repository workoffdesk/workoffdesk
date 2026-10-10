import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendPart, byteRange, fileName, finishPart, partSize, videoCover, videoFile } from '../../../src/uploads/fileUpload.js';

// A file from the phone, sent in parts into the uploads folder and kept there under its own name.
const ID = 'a1b2c3d4e5f6a7b8';
const uploads = () => mkdtempSync(join(tmpdir(), 'ts-file-upload-'));
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const video = (dir: string, seconds: number) => {
  const file = join(dir, `clip-${seconds}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=160x120:rate=2`, '-pix_fmt', 'yuv420p', file]);
  return readFileSync(file);
};
const send = async (dir: string, bytes: Buffer, id = ID) => {
  for (let at = 0; at < bytes.length; at += 4) await appendPart(dir, id, at, bytes.subarray(at, at + 4));
};

describe('appendPart', () => {
  it('adds it where the copy on the Mac ends, and says how much the Mac has', async () => {
    const dir = uploads();
    expect(await partSize(dir, ID)).toBe(0);
    expect(await appendPart(dir, ID, 0, Buffer.from('hello '))).toBe(6);
    expect(await appendPart(dir, ID, 6, Buffer.from('there'))).toBe(11);
    expect(await partSize(dir, ID)).toBe(11);
  });

  it.each([
    ['a part the Mac already has', 0],
    ['a part past where the copy on the Mac ends', 9],
  ])('refuses %s, saying where the copy ends', async (_, at) => {
    const dir = uploads();
    await appendPart(dir, ID, 0, Buffer.from('hello'));
    await expect(appendPart(dir, ID, at, Buffer.from('there'))).rejects.toMatchObject({ status: 409, code: 'upload-offset', message: 'the Mac has 5 bytes of this file' });
    expect(await partSize(dir, ID)).toBe(5);
  });

  it('adds a part sent twice at once only once', async () => {
    const dir = uploads();
    const twice = await Promise.allSettled([appendPart(dir, ID, 0, Buffer.from('hello')), appendPart(dir, ID, 0, Buffer.from('hello'))]);
    expect(twice.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await partSize(dir, ID)).toBe(5);
  });

  it('refuses what would make the file larger than 4 GiB', async () => {
    const dir = uploads();
    await appendPart(dir, ID, 0, Buffer.from('x'));
    const FILE_MAX = 4 * 1024 * 1024 * 1024;
    // Sparse: it takes no room on the disk.
    truncateSync(join(dir, '.parts', ID), FILE_MAX - 1);
    expect(await appendPart(dir, ID, FILE_MAX - 1, Buffer.from('x'))).toBe(FILE_MAX);
    await expect(appendPart(dir, ID, FILE_MAX, Buffer.from('x'))).rejects.toMatchObject({ status: 400, message: 'the file is too large' });
  });

  it.each(['../../etc/x1234567890abcdef', 'A1B2C3D4E5F6A7B8', 'short', 'a1b2c3d4e5f6a7b8/../a1b2c3d4e5f6a7b8', ''])(
    'refuses an upload id that is not one, %j',
    async (id) => {
      const dir = uploads();
      // Thrown before any promise, as the routes' handlers turn it into an answer.
      const asked = (f: () => Promise<unknown>) => Promise.resolve().then(f);
      await expect(asked(() => partSize(dir, id))).rejects.toMatchObject({ status: 400, message: 'bad upload id' });
      await expect(asked(() => appendPart(dir, id, 0, Buffer.from('x')))).rejects.toMatchObject({ status: 400, message: 'bad upload id' });
      await expect(asked(() => finishPart(dir, id, 'a.txt', 0))).rejects.toMatchObject({ status: 400, message: 'bad upload id' });
      expect(readdirSync(dir)).toEqual([]);
    },
  );
});

describe('fileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['照片 2026.heic', '照片 2026.heic'],
    ['  spaced.txt  ', 'spaced.txt'],
    ['../../etc/passwd', 'file.._.._etc_passwd'],
    ['a/b\\c.txt', 'a_b_c.txt'],
    ['say "hi".txt', 'say _hi_.txt'],
    ['line\nbreak\u0000.txt', 'line_break_.txt'],
    ['.env', 'file.env'],
    ['.', 'file.'],
    ['..', 'file..'],
    ['', 'file'],
    ['   ', 'file'],
  ])('keeps %j as %j', (name, kept) => {
    expect(fileName(name)).toBe(kept);
  });

  it('keeps the end of a long name, where what it is is said', () => {
    const kept = fileName(`${'x'.repeat(200)}.mov`);
    expect([...kept]).toHaveLength(120);
    expect(kept.endsWith('x.mov')).toBe(true);
  });
});

describe('finishPart', () => {
  it('keeps the file in a folder of its own under its own name, for this user only', async () => {
    const dir = uploads();
    await send(dir, Buffer.from('the whole file'));
    const sent = await finishPart(dir, ID, 'notes.txt', 14);
    expect(sent.frames).toBeNull();
    expect(basename(sent.path)).toBe('notes.txt');
    expect(dirname(dirname(sent.path))).toBe(dir);
    expect(basename(dirname(sent.path))).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}$/);
    expect(readFileSync(sent.path, 'utf8')).toBe('the whole file');
    expect(statSync(sent.path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(sent.path)).mode & 0o777).toBe(0o700);
    expect(existsSync(join(dir, '.parts', ID))).toBe(false);
  });

  it('returns where it was when its end is asked for again', async () => {
    const dir = uploads();
    await send(dir, Buffer.from('once'));
    const first = await finishPart(dir, ID, 'a.txt', 4);
    expect(await finishPart(dir, ID, 'a.txt', 4)).toEqual(first);
    expect(readdirSync(dir).filter((n) => n !== '.parts')).toHaveLength(1);
  });

  it.each([
    ['less of it than the phone sent', 10, 'the Mac has 4 of 10 bytes'],
    ['more of it than the phone sent', 2, 'the Mac has 4 of 2 bytes'],
  ])('does not end it while the Mac has %s', async (_, size, message) => {
    const dir = uploads();
    await send(dir, Buffer.from('part'));
    await expect(finishPart(dir, ID, 'a.txt', size)).rejects.toMatchObject({ status: 409, code: 'upload-incomplete', message });
    expect(await partSize(dir, ID)).toBe(4);
  });

  it('ends an empty file, which no part ever started', async () => {
    const dir = uploads();
    const sent = await finishPart(dir, ID, 'empty.txt', 0);
    expect(readFileSync(sent.path, 'utf8')).toBe('');
  });

  it('takes with it the parts of files left unended for two days', async () => {
    const dir = uploads();
    const OLD = 'f0f0f0f0f0f0f0f0';
    const RECENT = 'e0e0e0e0e0e0e0e0';
    await appendPart(dir, OLD, 0, Buffer.from('old'));
    await appendPart(dir, RECENT, 0, Buffer.from('recent'));
    const threeDays = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(join(dir, '.parts', OLD), threeDays, threeDays);
    await send(dir, Buffer.from('x'));
    await finishPart(dir, ID, 'a.txt', 1);
    expect(await partSize(dir, OLD)).toBe(0);
    expect(await partSize(dir, RECENT)).toBe(6);
  });
});

describe.skipIf(!hasFfmpeg)('a video once it is whole', () => {
  it('gives a video as stills a second apart, the first standing for it', async () => {
    const dir = uploads();
    const bytes = video(mkdtempSync(join(tmpdir(), 'ts-clip-')), 3);
    await send(dir, bytes);
    const sent = await finishPart(dir, ID, 'clip.mp4', bytes.length);
    expect(sent.frames).toEqual({ dir: join(dirname(sent.path), 'frames'), count: 3, every: 1 });
    expect(readdirSync(sent.frames!.dir).sort()).toEqual(['at-00m00s.jpg', 'at-00m01s.jpg', 'at-00m02s.jpg']);
    const folder = basename(dirname(sent.path));
    expect(await videoCover(dir, folder)).toEqual(readFileSync(join(sent.frames!.dir, 'at-00m00s.jpg')));
    expect(await videoFile(dir, folder)).toEqual({ file: sent.path, type: 'video/mp4', size: bytes.length });
  });

  it('gives a video as at most 30 stills, further apart for a longer one, named by minute and second', { timeout: 60_000 }, async () => {
    const dir = uploads();
    const bytes = video(mkdtempSync(join(tmpdir(), 'ts-clip-')), 65);
    await send(dir, bytes);
    const sent = await finishPart(dir, ID, 'long.mp4', bytes.length);
    expect(sent.frames).toMatchObject({ count: 22, every: 3 });
    const names = readdirSync(sent.frames!.dir).sort();
    expect(names[0]).toBe('at-00m00s.jpg');
    expect(names).toContain('at-01m03s.jpg');
  });

  it('still keeps a video, with no stills, when ffmpeg makes none of them', async () => {
    const dir = uploads();
    const bytes = video(mkdtempSync(join(tmpdir(), 'ts-clip-')), 2);
    await send(dir, bytes);
    const bin = mkdtempSync(join(tmpdir(), 'ts-ffmpeg-'));
    symlinkSync(execFileSync('/bin/sh', ['-c', 'command -v ffprobe'], { encoding: 'utf8' }).trim(), join(bin, 'ffprobe'));
    writeFileSync(join(bin, 'ffmpeg'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    try {
      const sent = await finishPart(dir, ID, 'clip.mp4', bytes.length);
      expect(sent.frames).toBeNull();
      expect(readdirSync(dirname(sent.path))).toEqual(['clip.mp4']);
    } finally {
      process.env.PATH = path;
    }
  });

  it('still keeps a video, with no stills, on a Mac without ffmpeg', async () => {
    const dir = uploads();
    const bytes = video(mkdtempSync(join(tmpdir(), 'ts-clip-')), 2);
    await send(dir, bytes);
    const path = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    try {
      const sent = await finishPart(dir, ID, 'clip.mp4', bytes.length);
      expect(sent.frames).toBeNull();
      expect(readFileSync(sent.path)).toEqual(bytes);
      expect(await videoCover(dir, basename(dirname(sent.path)))).toBeNull();
    } finally {
      process.env.PATH = path;
    }
  });
});

describe('videoCover and videoFile', () => {
  it.each(['..', '../uploads', '2026-01-01-000000-abcdeg', '2026-01-01-000000-abcdef/..'])('refuses a folder that is not one, %j', async (folder) => {
    const dir = uploads();
    await expect(videoCover(dir, folder)).rejects.toMatchObject({ status: 400, message: 'bad folder' });
    await expect(videoFile(dir, folder)).rejects.toMatchObject({ status: 400, message: 'bad folder' });
  });

  it('returns nothing for a folder that is not there, or holds no stills', async () => {
    const dir = uploads();
    expect(await videoFile(dir, '2026-01-01-000000-abcdef')).toBeNull();
    expect(await videoCover(dir, '2026-01-01-000000-abcdef')).toBeNull();
    mkdirSync(join(dir, '2026-01-01-000000-abcdef'));
    writeFileSync(join(dir, '2026-01-01-000000-abcdef', 'notes.txt'), 'x');
    expect(await videoCover(dir, '2026-01-01-000000-abcdef')).toBeNull();
  });

  it.each([
    ['trip.MOV', 'video/quicktime'],
    ['clip.m4v', 'video/mp4'],
    ['clip.webm', 'application/octet-stream'],
  ])('plays %s as %s', async (name, type) => {
    const dir = uploads();
    mkdirSync(join(dir, '2026-01-01-000000-abcdef', 'frames'), { recursive: true });
    writeFileSync(join(dir, '2026-01-01-000000-abcdef', name), 'abc');
    expect(await videoFile(dir, '2026-01-01-000000-abcdef')).toEqual({ file: join(dir, '2026-01-01-000000-abcdef', name), type, size: 3 });
  });
});

describe('byteRange', () => {
  it.each<[string | undefined, ReturnType<typeof byteRange>]>([
    [undefined, null],
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-', { start: 500, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=990-5000', { start: 990, end: 999 }],
    ['bytes=999-999', { start: 999, end: 999 }],
    ['bytes=1000-', 'unsatisfiable'],
    ['bytes=5-2', 'unsatisfiable'],
    ['bytes=-', null],
    ['bytes=0-1,5-6', null],
    ['items=0-1', null],
  ])('reads %j of a file of 1000 bytes as %j', (range, want) => {
    expect(byteRange(range, 1000)).toEqual(want);
  });

  it('returns none of an empty file', () => {
    expect(byteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});
