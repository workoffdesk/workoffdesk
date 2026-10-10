import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotAnImage, imageKind, readMentionedImage, saveImage } from '../../../src/uploads/media.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const scratch = () => mkdtempSync(join(tmpdir(), 'ts-media-'));

describe('imageKind', () => {
  it.each([
    ['png', PNG],
    ['jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])],
    ['gif', Buffer.from('GIF89a\x01\x00', 'latin1')],
    ['webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')],
    ['heic', Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00', 'latin1')],
    ['heic', Buffer.from('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00', 'latin1')],
  ])('knows a %s by its bytes', (kind, bytes) => {
    expect(imageKind(bytes)).toBe(kind);
  });

  it.each([
    ['text', Buffer.from('#!/bin/sh\nrm -rf /\n')],
    ['empty', Buffer.alloc(0)],
    ['a video', Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00', 'latin1')],
    ['RIFF that is not WEBP', Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt ', 'latin1')],
  ])('refuses %s', (_, bytes) => {
    expect(imageKind(bytes)).toBeNull();
  });
});

describe('saveImage', () => {
  it('keeps the image under a fresh name with its real extension, readable only by the owner', async () => {
    const dir = join(scratch(), 'uploads');
    const a = await saveImage(dir, PNG);
    const b = await saveImage(dir, PNG);
    expect(a).not.toBe(b);
    expect(a.startsWith(`${dir}/`)).toBe(true);
    expect(a).toMatch(/\/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.png$/);
    expect(readFileSync(a)).toEqual(PNG);
    expect(statSync(a).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('refuses what is not an image, and writes nothing', async () => {
    const dir = join(scratch(), 'uploads');
    await expect(saveImage(dir, Buffer.from('<html>'))).rejects.toBeInstanceOf(NotAnImage);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('turns a HEIC photo into a JPEG, which Claude can read', async () => {
    const dir = join(scratch(), 'uploads');
    const src = join(scratch(), 'one.png');
    writeFileSync(src, PNG);
    const heic = join(scratch(), 'one.heic');
    execFileSync('sips', ['-s', 'format', 'heic', src, '--out', heic], { stdio: 'ignore' });
    expect(imageKind(readFileSync(heic))).toBe('heic');

    const saved = await saveImage(dir, readFileSync(heic));
    expect(saved).toMatch(/\.jpg$/);
    expect(imageKind(readFileSync(saved))).toBe('jpg');
    expect(readdirSync(dir)).toEqual([saved.split('/').pop()]);
  });

  it('clears out uploads older than 30 days when a new one arrives', async () => {
    const dir = join(scratch(), 'uploads');
    const now = Date.now();
    const old = await saveImage(dir, PNG);
    const recent = await saveImage(dir, PNG);
    const day = 24 * 60 * 60;
    utimesSync(old, now / 1000 - 31 * day, now / 1000 - 31 * day);
    utimesSync(recent, now / 1000 - 29 * day, now / 1000 - 29 * day);
    const fresh = await saveImage(dir, PNG);
    expect(readdirSync(dir).sort()).toEqual([recent, fresh].map((f) => f.split('/').pop()).sort());
  });
});

// What Claude names in a session is shown from the Mac, and nothing it did not name.
describe('readMentionedImage', () => {
  const setup = () => {
    const home = scratch();
    const shot = join(home, 'shots', '截图 1.png');
    mkdirSync(join(home, 'shots'));
    writeFileSync(shot, PNG);
    writeFileSync(join(home, 'notes.txt'), 'secret');
    writeFileSync(join(home, 'fake.png'), '#!/bin/sh\n');
    mkdirSync(join(home, 'folder.png'));
    symlinkSync(join(home, 'notes.txt'), join(home, 'link-to-notes.png'));
    symlinkSync(shot, join(home, 'link-to-shot.webp'));
    writeFileSync(join(home, 'shot.dat'), PNG);
    symlinkSync(join(home, 'shot.dat'), join(home, 'link-to-dat.png'));
    const transcript = join(home, 't.jsonl');
    const said = (...paths: string[]) =>
      writeFileSync(transcript, paths.map((p) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `看 ${p}` }] } })}\n`).join(''));
    return { home, shot, transcript, said };
  };

  it('reads an image the transcript names, typed by its bytes', async () => {
    const { shot, transcript, said } = setup();
    said(shot);
    expect(await readMentionedImage(transcript, shot)).toEqual({ bytes: PNG, type: 'image/png' });
  });

  it('reads one named from home with ~', async () => {
    const { home, transcript, said } = setup();
    said('~/shots/截图 1.png');
    expect(await readMentionedImage(transcript, '~/shots/截图 1.png', { home })).toMatchObject({ type: 'image/png' });
  });

  it('follows a link to an image', async () => {
    const { home, transcript, said } = setup();
    said(join(home, 'link-to-shot.webp'));
    expect(await readMentionedImage(transcript, join(home, 'link-to-shot.webp'))).toMatchObject({ type: 'image/png' });
  });

  it('says an image it named is gone when the file is', async () => {
    const { home, transcript, said } = setup();
    said(join(home, 'deleted.png'));
    expect(await readMentionedImage(transcript, join(home, 'deleted.png'))).toBe('gone');
  });

  it('finds a name that runs across the pieces the transcript is read in', async () => {
    const { shot, transcript, said } = setup();
    said(shot);
    for (const chunk of [7, 16, 33]) expect(await readMentionedImage(transcript, shot, { chunk })).toMatchObject({ type: 'image/png' });
  });

  it('finds a name the transcript writes escaped, as JSON does with quotes', async () => {
    const { home, transcript, said } = setup();
    const quoted = join(home, 'say "hi".png');
    writeFileSync(quoted, PNG);
    said(quoted);
    expect(await readMentionedImage(transcript, quoted)).toMatchObject({ type: 'image/png' });
  });

  // Each: what is asked for, and what the transcript names.
  it.each([
    ['an image the transcript never names', (h: string) => [join(h, 'shots', '截图 1.png'), []]],
    ['a file that is not an image, though named', (h: string) => [join(h, 'notes.txt'), [join(h, 'notes.txt')]]],
    ['a file named like an image that is not one', (h: string) => [join(h, 'fake.png'), [join(h, 'fake.png')]]],
    ['a link named like an image to a file that is not one', (h: string) => [join(h, 'link-to-notes.png'), [join(h, 'link-to-notes.png')]]],
    ['an image whose name says it is not one', (h: string) => [join(h, 'shot.dat'), [join(h, 'shot.dat')]]],
    ['a link named like an image to an image whose name says it is not one', (h: string) => [join(h, 'link-to-dat.png'), [join(h, 'link-to-dat.png')]]],
    ['a folder named like an image', (h: string) => [join(h, 'folder.png'), [join(h, 'folder.png')]]],
    ['a relative path', () => ['shots/截图 1.png', ['shots/截图 1.png']]],
    ['another spelling of a path that is named', (h: string) => [`${h}/shots/../shots/截图 1.png`, [join(h, 'shots', '截图 1.png')]]],
  ] as [string, (h: string) => [string, string[]]][])('refuses %s', async (_, paths) => {
    const { home, transcript, said } = setup();
    const [asked, named] = paths(home);
    said(...named);
    expect(await readMentionedImage(transcript, asked, { home })).toBe('refused');
  });

  it('refuses an image larger than it will send', async () => {
    const { shot, transcript, said } = setup();
    said(shot);
    expect(await readMentionedImage(transcript, shot, { maxBytes: PNG.length - 1 })).toBe('refused');
  });
});
