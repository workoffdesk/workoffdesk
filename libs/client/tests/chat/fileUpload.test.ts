import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiInit } from '../../src/base/api';
import { newUploadId, sendFile } from '../../src/chat/fileUpload';

// The Mac's side, as apps/server/src/uploads/fileUpload.ts keeps it: a part goes on only where its copy ends (409
// otherwise), and is asked where that is. `trouble` is what the next PUTs meet, one each: an error before the
// Mac sees the part, or an answer lost after it took it. `says` is whether each GET is answered.
type Trouble = Error | 'ok' | 'lost';
const PART = 2 * 1024 * 1024;

function mac(o: { held?: number; says?: boolean[] } = {}) {
  let copy = new Uint8Array(o.held ?? 0);
  const trouble: Trouble[] = [];
  const says = [...(o.says ?? [])];
  const puts: { at: number; length: number; t: number }[] = [];
  const done: { json: unknown; idempotent?: boolean }[] = [];
  const api = async <T,>(path: string, init: ApiInit = {}): Promise<T> => {
    expect(path.startsWith('/api/uploads/parts/up-1')).toBe(true);
    if (path.endsWith('/done')) {
      done.push({ json: init.json, idempotent: init.idempotent });
      return { path: '/uploads/report.pdf', frames: null } as T;
    }
    if (init.method !== 'PUT') {
      if (says.shift() === false) throw new TypeError('Network request failed');
      return { size: copy.length } as T;
    }
    const at = Number((init.headers as Record<string, string>)['upload-offset']);
    const body = init.body as Uint8Array;
    puts.push({ at, length: body.length, t: Date.now() });
    const next = trouble.shift();
    if (next instanceof Error) throw next;
    if (at !== copy.length) throw new ApiError(409, `the Mac has ${copy.length} bytes of this file`, undefined, 'upload-offset');
    const grown = new Uint8Array(copy.length + body.length);
    grown.set(copy);
    grown.set(body, copy.length);
    copy = grown;
    if (next === 'lost') throw new TypeError('Network request failed');
    return { size: copy.length } as T;
  };
  return { api, trouble, puts, done, copy: () => copy };
}

const file = (size: number, o: { later?: boolean } = {}) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 251;
  const reads: [number, number][] = [];
  return {
    bytes,
    reads,
    id: 'up-1',
    name: 'report.pdf',
    size,
    read: (at: number, length: number) => {
      reads.push([at, length]);
      const part = bytes.slice(at, at + length);
      return o.later ? Promise.resolve(part) : part;
    },
  };
};

// Byte for byte; toEqual walks megabytes one element at a time.
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

// Runs the waits between tries as they come, until the upload is over.
const settled = async <T,>(p: Promise<T>) => {
  const out = p.then(
    (v) => ({ v }),
    (e: unknown) => ({ e }),
  );
  await vi.runAllTimersAsync();
  return out;
};

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

describe('sendFile', () => {
  it.each([false, true])('sends the file in parts, each where the Mac has it to, then says it is done (read later: %s)', async (later) => {
    const m = mac();
    const f = file(2 * PART + 3, { later });
    const progress: number[] = [];
    const r = await settled(sendFile(m.api, f, (n) => progress.push(n)));
    expect(r).toEqual({ v: { path: '/uploads/report.pdf', frames: null } });
    expect(m.puts.map((p) => [p.at, p.length])).toEqual([
      [0, PART],
      [PART, PART],
      [2 * PART, 3],
    ]);
    expect(progress).toEqual([PART, 2 * PART, 2 * PART + 3]);
    expect(same(m.copy(), f.bytes)).toBe(true);
    expect(m.done).toEqual([{ json: { name: 'report.pdf', size: 2 * PART + 3 }, idempotent: true }]);
  });

  it('goes on from where the Mac has it to after an earlier try', async () => {
    const m = mac({ held: PART });
    const f = file(PART + 10);
    await settled(sendFile(m.api, f, () => {}));
    expect(f.reads).toEqual([[PART, 10]]);
  });

  it('starts from the beginning when the Mac cannot say where it has it to', async () => {
    const m = mac({ says: [false] });
    const f = file(10);
    await settled(sendFile(m.api, f, () => {}));
    expect(m.puts.map((p) => p.at)).toEqual([0]);
  });

  it('sends only the end for an empty file', async () => {
    const m = mac();
    expect(await settled(sendFile(m.api, file(0), () => {}))).toEqual({ v: { path: '/uploads/report.pdf', frames: null } });
    expect(m.puts).toEqual([]);
  });

  describe('when a part fails', () => {
    it('asks the Mac where it has the file to and goes on from there, losing only that part', async () => {
      const m = mac();
      m.trouble.push('ok', 'lost');
      const f = file(3 * PART);
      const progress: number[] = [];
      expect(await settled(sendFile(m.api, f, (n) => progress.push(n)))).toEqual({ v: expect.anything() });
      expect(m.puts.map((p) => p.at)).toEqual([0, PART, 2 * PART]);
      expect(progress).toEqual([PART, 2 * PART, 3 * PART]);
      expect(same(m.copy(), f.bytes)).toBe(true);
    });

    it('goes where the Mac says when the part was sent somewhere else', async () => {
      const m = mac({ held: 5, says: [false] });
      const f = file(20);
      await settled(sendFile(m.api, f, () => {}));
      expect(m.puts.map((p) => p.at)).toEqual([0, 5]);
      expect(same(m.copy().slice(5), f.bytes.slice(5))).toBe(true);
    });

    it('keeps its place when the Mac cannot say after a failure', async () => {
      const m = mac({ says: [true, false] });
      m.trouble.push('ok', new TypeError('Network request failed'));
      const f = file(PART + 5);
      const progress: number[] = [];
      await settled(sendFile(m.api, f, (n) => progress.push(n)));
      expect(m.puts.map((p) => p.at)).toEqual([0, PART, PART]);
      expect(progress).toEqual([PART, PART, PART + 5]);
      expect(same(m.copy(), f.bytes)).toBe(true);
    });

    it.each<[string, Error]>([
      ['the line drops', new TypeError('Network request failed')],
      ['the Mac fails', new ApiError(503, 'unavailable')],
      ['it takes too long', new ApiError(408, 'timeout')],
      ['it is sent too often', new ApiError(429, 'slow down')],
      ['the Mac has more or less of it than thought, every time', new ApiError(409, 'the Mac has 3 bytes of this file')],
    ])('retries with growing waits when %s, and gives up after 8 in a row', async (_, e) => {
      const m = mac();
      m.trouble.push(...Array.from({ length: 8 }, () => e));
      expect(await settled(sendFile(m.api, file(10), () => {}))).toEqual({ e });
      expect(m.puts.slice(1).map((p, i) => p.t - m.puts[i].t)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);
      expect(m.done).toEqual([]);
    });

    it('counts failures in a row afresh once a part gets through', async () => {
      const m = mac();
      const e = new ApiError(503, 'unavailable');
      const seven = Array.from({ length: 7 }, () => e);
      m.trouble.push(...seven, 'ok', ...seven);
      expect(await settled(sendFile(m.api, file(PART + 1), () => {}))).toEqual({ v: expect.anything() });
      expect(m.puts).toHaveLength(16);
      expect(m.puts.slice(6, 10).map((p, i) => m.puts[6 + i + 1].t - p.t)).toEqual([15_000, 0, 1000, 2000]);
    });

    it.each<[string, number]>([
      ['too large', 413],
      ['the person is signed out', 401],
      ['it is not one the Mac takes', 400],
    ])('ends the upload at once when it is refused for what it is: %s', async (_, status) => {
      const m = mac();
      const e = new ApiError(status, 'refused');
      m.trouble.push(e);
      expect(await settled(sendFile(m.api, file(10), () => {}))).toEqual({ e });
      expect(m.puts).toHaveLength(1);
    });
  });
});

describe('newUploadId', () => {
  it('makes 24 letters and digits, a new id each time', () => {
    const ids = new Set(Array.from({ length: 50 }, newUploadId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{24}$/);
  });
});
