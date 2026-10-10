import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { Tmux } from '../../../../src/system/tmux.js';
import { addUser, ORIGIN, RP_ID, signIn } from '../../../helpers/app.js';

// The routes a file from the phone comes in by, in parts, and a video sent so is played back by.
const FOLDER = '2026-01-01-000000-abcdef';
const dir = mkdtempSync(join(tmpdir(), 'ts-uploads-'));
const uploadsDir = join(dir, 'uploads');
mkdirSync(join(uploadsDir, FOLDER, 'frames'), { recursive: true });
const VIDEO = Buffer.from('0123456789');
writeFileSync(join(uploadsDir, FOLDER, 'clip.mov'), VIDEO);
writeFileSync(join(uploadsDir, FOLDER, 'frames', 'at-00m00s.jpg'), 'first still');

let base = '';
let cookie = '';
let close = async () => {};
beforeAll(async () => {
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  const machine = new LocalMachine({ tmux: new Tmux({ socket: `unused-${process.pid}`, conf: '/dev/null' }), store, claudeSettingsPath: '/dev/null' });
  const { app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log'), media: { uploadsDir } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
  cookie = await signIn(app);
});
afterAll(() => close());

const api = (path: string, o: { method?: string; json?: unknown; body?: Buffer; headers?: Record<string, string> } = {}) =>
  fetch(base + path, {
    method: o.method,
    headers: { origin: ORIGIN, ...(cookie && { cookie }), ...(o.json !== undefined && { 'content-type': 'application/json' }), ...o.headers },
    body: o.json !== undefined ? JSON.stringify(o.json) : o.body,
  });
const part = (id: string, at: string | undefined, body: Buffer, type?: string) =>
  api(`/api/uploads/parts/${id}`, { method: 'PUT', body, headers: { ...(at !== undefined && { 'upload-offset': at }), ...(type && { 'content-type': type }) } });

describe('/api/uploads/parts/:id', () => {
  it('takes a file on from where the Mac has it, whatever type it is said to be, and keeps it once whole', async () => {
    const id = 'b1b2c3d4e5f6a7b8';
    expect(await (await api(`/api/uploads/parts/${id}`)).json()).toEqual({ size: 0 });
    expect(await (await part(id, '0', Buffer.from('hello '), 'video/quicktime')).json()).toEqual({ size: 6 });
    expect(await (await part(id, '6', Buffer.from('there'))).json()).toEqual({ size: 11 });
    expect(await (await api(`/api/uploads/parts/${id}`)).json()).toEqual({ size: 11 });
    const done = await api(`/api/uploads/parts/${id}/done`, { method: 'POST', json: { name: 'notes.txt', size: 11 } });
    expect(done.status).toBe(201);
    expect(await done.json()).toMatchObject({ path: expect.stringMatching(new RegExp(`^${uploadsDir}/[^/]+/notes\\.txt$`)), frames: null });
  });

  it('says where the Mac has it to when a part is not where it ends', async () => {
    const id = 'c1b2c3d4e5f6a7b8';
    await part(id, '0', Buffer.from('hello'));
    const r = await part(id, '2', Buffer.from('llo'));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'upload-offset' });
  });

  it.each([
    ['no place', undefined],
    ['a place that is not a number', 'start'],
    ['a place before the start', '-1'],
    ['a place that is not a whole byte', '1.5'],
  ])('refuses a part with %s to go', async (_, at) => {
    const r = await part('d1b2c3d4e5f6a7b8', at, Buffer.from('x'));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'upload-offset is not a byte count' });
  });

  it('keeps nothing of a part larger than 8 MiB', async () => {
    // Answered 413 as soon as its length is read, which may close the line before all of it is sent.
    const r = await part('e1b2c3d4e5f6a7b8', '0', Buffer.alloc(8 * 1024 * 1024 + 1)).catch(() => null);
    if (r) expect(r.status).toBe(413);
    expect(await (await api('/api/uploads/parts/e1b2c3d4e5f6a7b8')).json()).toEqual({ size: 0 });
  });

  it.each([
    ['no name', { size: 1 }],
    ['no size', { name: 'a.txt' }],
    ['a size that is not a whole number', { name: 'a.txt', size: 1.5 }],
    ['a size below nothing', { name: 'a.txt', size: -1 }],
    ['a size that is text', { name: 'a.txt', size: '1' }],
  ])('does not end it with %s', async (_, json) => {
    const r = await api('/api/uploads/parts/f1b2c3d4e5f6a7b8/done', { method: 'POST', json });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'name and size are needed' });
  });

  it('refuses an upload id that is not one', async () => {
    const r = await api('/api/uploads/parts/..%2F..%2Fstate.json');
    expect(r.status).toBe(400);
  });
});

describe('GET /api/uploads/:folder/video and /cover', () => {
  const play = (range?: string, folder = FOLDER) => api(`/api/uploads/${folder}/video`, { headers: range ? { range } : {} });

  it('plays a video whole, saying it takes ranges and is not kept', async () => {
    const r = await play();
    expect(r.status).toBe(200);
    expect(Object.fromEntries(['content-type', 'accept-ranges', 'content-length', 'cache-control'].map((h) => [h, r.headers.get(h)]))).toEqual({
      'content-type': 'video/quicktime',
      'accept-ranges': 'bytes',
      'content-length': '10',
      'cache-control': 'private, no-store',
    });
    expect(Buffer.from(await r.arrayBuffer())).toEqual(VIDEO);
  });

  it.each([
    ['bytes=2-5', 'bytes 2-5/10', '2345'],
    ['bytes=7-', 'bytes 7-9/10', '789'],
    ['bytes=-3', 'bytes 7-9/10', '789'],
  ])('plays the range a player asks for, %s', async (range, contentRange, body) => {
    const r = await play(range);
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(contentRange);
    expect(r.headers.get('content-length')).toBe(String(body.length));
    expect(await r.text()).toBe(body);
  });

  it('says which bytes there are when asked for a range outside it', async () => {
    const r = await play('bytes=10-');
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe('bytes */10');
  });

  it('shows it by its first still', async () => {
    const r = await api(`/api/uploads/${FOLDER}/cover`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(await r.text()).toBe('first still');
  });

  it.each(['video', 'cover'])('has no %s for a folder that is not there', async (what) => {
    const r = await api(`/api/uploads/2026-01-02-000000-abcdef/${what}`);
    expect(r.status).toBe(404);
  });

  it.each(['video', 'cover'])('refuses a %s of what is not a folder of uploads', async (what) => {
    const r = await api(`/api/uploads/..%2F..%2Fuploads/${what}`);
    expect(r.status).toBe(400);
  });

  it('plays it only to who is signed in', async () => {
    const r = await fetch(`${base}/api/uploads/${FOLDER}/video`, { headers: { origin: ORIGIN } });
    expect(r.status).toBe(401);
  });
});
