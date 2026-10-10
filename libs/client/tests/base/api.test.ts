import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiInit, createApi, errorText, serverBase } from '../../src/base/api';

const FALLBACK = 'Not opened';

// What a failed request ends as, to the screen: fetch rejects, answers with this, or never answers.
async function failureOf(net: (url: string, init: RequestInit) => Promise<Response>, init: Parameters<ReturnType<typeof createApi>['api']>[1] = { method: 'POST', json: {} }) {
  vi.stubGlobal('fetch', vi.fn(net));
  const { api } = createApi({ base: () => 'https://mac', onUnauthorized: () => {} });
  let caught: unknown = 'not failed';
  const done = api('/api/x', init).catch((e) => (caught = e));
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  await done;
  return caught;
}

const html = (status: number) => () => Promise.resolve(new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }));

describe('errorText', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ['refused by iOS', () => Promise.reject(new TypeError('fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)'))],
    ['refused by a browser', () => Promise.reject(new TypeError('Load failed'))],
    ['dropped with a native exception that is not a TypeError', () => Promise.reject(Object.assign(new Error('UnexpectedException: The network connection was lost.'), { code: 'ERR_FETCH' }))],
    ['answered by a proxy page instead of the Mac', html(502)],
  ])('says a request %s cannot reach the server', async (_, net) => {
    const said = errorText(await failureOf(net), FALLBACK);
    expect(said).toBe(t.noServer);
  });

  it('says a request given up for never answering cannot reach the server', async () => {
    // A dead connection: nothing comes back until the request is aborted.
    const hang = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const e = await failureOf(hang, { method: 'POST', json: {}, idempotent: true });
    expect(errorText(e, FALLBACK)).toBe(t.noServer);
  });

  it("uses the caller's own sentence for a request that got no answer", async () => {
    const refused = () => Promise.reject(new TypeError('Load failed'));
    expect(errorText(await failureOf(refused), FALLBACK, 'Not ended: cannot reach the Mac')).toBe('Not ended: cannot reach the Mac');
    expect(errorText(await failureOf(html(502)), FALLBACK, 'Not ended: cannot reach the Mac')).toBe('Not ended: cannot reach the Mac');
    expect(errorText(new ApiError(404, ''), FALLBACK, 'Not ended: cannot reach the Mac')).toBe(FALLBACK);
  });

  it("says in the phone's language that a thing is gone when the server has no such thing", async () => {
    const gone = () => Promise.resolve(new Response(JSON.stringify({ error: 'no such session' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    expect(errorText(await failureOf(gone), FALLBACK)).toBe(t.goneOnMac);
  });

  it('shows the fallback, not the page or its status text, for a non-JSON answer', async () => {
    const said = errorText(await failureOf(html(500)), FALLBACK);
    expect(said).toBe(FALLBACK);
  });

  it("shows what the server said, in the phone's language when it names a code", async () => {
    const json = (body: object) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 409, headers: { 'content-type': 'application/json' } }));
    expect(errorText(await failureOf(json({ error: 'Name taken' })), FALLBACK)).toBe('Name taken');
    expect(errorText(await failureOf(json({ error: 'x', code: 'dialog-open' })), FALLBACK)).toBe(t.serverErrors['dialog-open']);
  });

  it.each([new Error('UnexpectedException: something native'), 'a string', null, undefined, new ApiError(500, '')])(
    'shows the fallback for anything else (%s), never its text',
    (e) => {
      expect(errorText(e, FALLBACK)).toBe(FALLBACK);
    },
  );
});

describe('serverBase', () => {
  it.each([
    ['workoffdesk.example.com', 'https://workoffdesk.example.com'],
    ['  https://WorkOffDesk.Example.com/ ', 'https://workoffdesk.example.com'],
    ['http://localhost:4792', 'http://localhost:4792'],
    ['localhost:4792', 'https://localhost:4792'],
    ['https://example.com/workoffdesk//', 'https://example.com/workoffdesk'],
    ['http://192.168.1.5:8080', 'http://192.168.1.5:8080'],
  ])('reads %j as %j', (typed, base) => expect(serverBase(typed)).toBe(base));

  it.each(['', '   ', 'ftp://example.com', 'https://', 'not an address', 'https://example.com?x=1', 'javascript:alert(1)'])(
    'refuses %j',
    (typed) => expect(serverBase(typed)).toBeNull(),
  );
});

// A server that takes the request and never answers (stopped, or a dead connection), until it is aborted.
const hang = (_: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

// How a request against a hung server ends, and by when.
function against(init: ApiInit) {
  const fetch = vi.fn(hang);
  vi.stubGlobal('fetch', fetch);
  const { api } = createApi({ base: () => 'https://mac', onUnauthorized: () => {} });
  const outcome: { error?: unknown } = {};
  const done = api('/api/x', init).then(
    () => (outcome.error = 'answered'),
    (e) => (outcome.error = e),
  );
  return { fetch, outcome, done };
}

const BOUND_MS = 60_000;

describe('createApi', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['POST', 'PATCH', 'PUT'])('ends a %s the server never answers within a bound, sent once, as maybe done', async (method) => {
    const { fetch, outcome, done } = against({ method, json: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    expect(outcome.error).toBeDefined();
    await done;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorText(outcome.error, 'Not saved')).toBe(t.noAnswer);
    // A caller's own sentence for an unreachable server is not this: the server may have done it.
    expect(errorText(outcome.error, 'Not saved', 'Not ended: cannot reach the Mac')).toBe(t.noAnswer);
  });

  it('ends an unanswered delete within a bound too, retrying it since deletes repeat safely', async () => {
    const { fetch, outcome, done } = against({ method: 'DELETE' });
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    expect(outcome.error).toBeDefined();
    await done;
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(errorText(outcome.error, 'Not ended')).toBe(t.noServer);
  });

  it('gives an upload time for its bytes on a slow line and still ends it', async () => {
    const body = new Blob([new Uint8Array(2_000_000)]);
    const { outcome, done } = against({ method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });
    await vi.advanceTimersByTimeAsync(BOUND_MS);
    expect(outcome.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await done;
    expect(errorText(outcome.error, 'Not uploaded')).toBe(t.noAnswer);
  });

  it('says a write refused outright cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Load failed'))));
    const { api } = createApi({ base: () => 'https://mac', onUnauthorized: () => {} });
    const e = await api('/api/x', { method: 'PATCH', json: {} }).catch((e: unknown) => e);
    expect(errorText(e, 'Not saved')).toBe(t.noServer);
  });
});

// Every answer says which release of the server gave it, so a page or app on older code can tell.
function answering(res: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async () => res()));
  const seen: string[] = [];
  const { api } = createApi({ base: () => 'https://mac', onUnauthorized: () => {}, onVersion: (v) => seen.push(v) });
  return { api, seen };
}

describe('onVersion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['a read', 200, '{"a":1}'],
    ['nothing to say', 204, null],
    ['a refusal', 404, '{"error":"gone"}'],
    ['a server error', 500, '{}'],
  ])('reports the release on %s', async (_, status, body) => {
    const { api, seen } = answering(() => new Response(body, { status, headers: { 'x-workoffdesk-version': '2.17.18', 'content-type': 'application/json' } }));
    await api('/api/x', { method: 'DELETE' }).catch((e) => expect(e).toBeInstanceOf(ApiError));
    expect(seen).toEqual(['2.17.18']);
  });

  it('reports nothing when the server does not name one (an older server)', async () => {
    const { api, seen } = answering(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await api('/api/x');
    expect(seen).toEqual([]);
  });
});
