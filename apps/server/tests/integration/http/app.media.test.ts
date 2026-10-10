import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../helpers/app.js';
import { liveServer } from '../../helpers/server.js';

const live = liveServer('me', { signedIn: true });
const { dir, uploadsDir } = live;

describe('/api/uploads', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const post = (path: string, body: Buffer, type: string | undefined, extra: Record<string, string> = {}) =>
    fetch(live.server.base + path, { method: 'POST', body, headers: { origin: ORIGIN, cookie: live.cookie, ...(type === undefined ? {} : { 'content-type': type }), ...extra } });

  it('keeps an uploaded image on the Mac and answers with its path', async () => {
    const r = await post('/api/uploads', PNG, 'image/png');
    expect(r.status).toBe(201);
    const { path } = await r.json();
    expect(path.startsWith(`${uploadsDir}/`)).toBe(true);
    expect(readFileSync(path)).toEqual(PNG);
  });

  it('takes a photo whatever type the phone calls it, judging by its bytes', async () => {
    expect((await post('/api/uploads', PNG, 'application/octet-stream')).status).toBe(201);
    expect((await post('/api/uploads', PNG, 'image/heic')).status).toBe(201);
  });

  it('shows an uploaded image back to the phone, as an image and nothing else', async () => {
    const { path } = await (await post('/api/uploads', PNG, 'image/png')).json();
    const name = path.split('/').pop();
    const r = await fetch(`${live.server.base}/api/uploads/${name}`, { headers: { cookie: live.cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toMatch(/^private/);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(PNG);
  });

  it('shows nothing but uploads, and only by their own names', async () => {
    writeFileSync(join(uploadsDir, '2026-01-01-000000-abcdef.png'), '<svg onload=alert(1)>');
    writeFileSync(join(dir, '2026-01-01-000000-aaaaaa.png'), PNG);
    for (const name of ['2026-01-01-000000-ffffff.png', 'state.json', '..%2Fstate.json', '..%2F2026-01-01-000000-aaaaaa.png', '2026-01-01-000000-abcdef.svg']) {
      expect((await fetch(`${live.server.base}/api/uploads/${name}`, { headers: { cookie: live.cookie } })).status, name).toBe(404);
    }
    // Named like an image but not one: not served as anything a browser would run.
    expect((await fetch(`${live.server.base}/api/uploads/2026-01-01-000000-abcdef.png`, { headers: { cookie: live.cookie } })).status).toBe(404);
  });

  // React Native's fetch sends a Blob with an empty Content-Type; the header says nothing about the file.
  it.each([
    ['an empty type', ''],
    ['no type', undefined],
    ['a text type', 'text/plain'],
    ['a JSON type', 'application/json'],
    ['a form type', 'application/x-www-form-urlencoded'],
  ])('takes an image sent with %s, judging by its bytes', async (_, type) => {
    const r = await post('/api/uploads', PNG, type);
    expect(r.status).toBe(201);
    expect(readFileSync((await r.json()).path)).toEqual(PNG);
  });

  it.each([
    ['an image type', 'image/png'],
    ['an empty type', ''],
    ['no type', undefined],
    ['a JSON type', 'application/json'],
  ])('refuses bytes that are not an image, sent with %s', async (_, type) => {
    const before = readdirSync(uploadsDir).length;
    const r = await post('/api/uploads', Buffer.from('{"not":"an image"}'), type);
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ code: 'not-an-image' });
    expect(readdirSync(uploadsDir).length).toBe(before);
  });

  it.each([['no type', undefined], ['an image type', 'image/png']])('refuses an empty upload sent with %s', async (_, type) => {
    const r = await post('/api/uploads', Buffer.alloc(0), type);
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ code: 'not-an-image' });
  });

  it('leaves every other route reading a body by its type', async () => {
    const r = await post('/api/m/local/sessions', Buffer.from(JSON.stringify({ kind: 'shell' })), 'application/octet-stream');
    expect(r.status).toBe(415);
  });

  it('refuses an upload that is not an image', async () => {
    const r = await post('/api/uploads', Buffer.from('<script>'), 'image/png');
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ code: 'not-an-image' });
  });

  it('takes a full-size phone photo, but not something absurd', async () => {
    const photo = Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024)]);
    expect((await post('/api/uploads', photo, 'image/png')).status).toBe(201);
    // Refused on its declared size; the server may hang up while it is still being sent.
    const before = readdirSync(uploadsDir).length;
    const status = await post('/api/uploads', Buffer.concat([PNG, Buffer.alloc(40 * 1024 * 1024)]), 'image/png').then(
      (r) => r.status,
      () => 'hung up',
    );
    expect([413, 'hung up']).toContain(status);
    expect(readdirSync(uploadsDir).length).toBe(before);
  });

  it('has no transcription on the Mac', async () => {
    expect((await post('/api/transcribe', Buffer.from('m4a'), 'audio/mp4')).status).toBe(404);
  });

  it('turns away an anonymous upload before reading it', async () => {
    const r = await fetch(live.server.base + '/api/uploads', {
      method: 'POST',
      body: Buffer.alloc(40 * 1024 * 1024),
      headers: { origin: ORIGIN, 'content-type': 'image/png' },
    });
    expect(r.status).toBe(401);
  });
});
