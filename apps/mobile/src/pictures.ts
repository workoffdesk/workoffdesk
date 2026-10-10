import { ApiError, NetworkError, SLOW_MS, type Slow } from '@workoffdesk/client/base/api';
import { isTransient, withRetry } from '@workoffdesk/client/base/retry';
import { useEffect, useState } from 'react';

// Pictures come over the same line as every other request and get the same care. React Native's Image
// downloads on its own, with no time limit and no second try: on a connection that died without saying so
// it waits for good. Here a download that gets no bytes for this long is dropped and asked again, while a
// slow one that keeps coming is waited for (the same limit a read has, api.ts).
const IDLE_MS = 8000;
// Pictures kept once come, so the full-screen viewer shows at once what the chat already has.
const KEPT = 24;

export type Source = { uri: string; headers: Record<string, string> };
export type PictureLoad = { state: 'loading' } | { state: 'shown'; uri: string } | { state: 'gone' } | { state: 'failed' };

const pathOf = (uri: string) => uri.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];

function download(src: Source, onSlow: (slow: Slow) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const xhr = new XMLHttpRequest();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: Slow['outcome'], result: () => void) => {
      clearTimeout(idle);
      const ms = Date.now() - started;
      if (ms >= SLOW_MS) onSlow({ method: 'GET', path: pathOf(src.uri), ms, outcome });
      result();
    };
    const waitForBytes = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        xhr.abort();
        settle('network', () => reject(new NetworkError('no bytes')));
      }, IDLE_MS);
    };
    xhr.open('GET', src.uri);
    for (const [k, v] of Object.entries(src.headers)) xhr.setRequestHeader(k, v);
    xhr.responseType = 'blob';
    xhr.onprogress = waitForBytes;
    xhr.onerror = () => settle('network', () => reject(new NetworkError('picture download failed')));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return settle(xhr.status, () => reject(new ApiError(xhr.status, '')));
      const reader = new FileReader();
      reader.onload = () => settle(xhr.status, () => resolve(String(reader.result)));
      reader.onerror = () => settle(xhr.status, () => reject(new Error('picture unreadable')));
      reader.readAsDataURL(xhr.response as Blob);
    };
    waitForBytes();
    xhr.send();
  });
}

// A picture still on the phone, as one just picked: there is nothing to download.
const onPhone = (uri: string) => !/^https?:/i.test(uri);

export function createPictures(onSlow: (slow: Slow) => void) {
  const shown = new Map<string, string>();
  const coming = new Map<string, Promise<string>>();

  const keep = (key: string, uri: string) => {
    shown.delete(key);
    shown.set(key, uri);
    for (const old of shown.keys()) {
      if (shown.size <= KEPT) break;
      shown.delete(old);
    }
  };

  const load = (src: Source): Promise<string> => {
    let p = coming.get(src.uri);
    if (!p) {
      p = withRetry(() => download(src, onSlow)).then((uri) => {
        keep(src.uri, uri);
        return uri;
      });
      p.finally(() => coming.delete(src.uri)).catch(() => {});
      coming.set(src.uri, p);
    }
    return p;
  };

  // The picture at src as it stands, and a way to ask for it again once it has failed.
  return function usePicture(src: Source): [PictureLoad, () => void] {
    const now = (): PictureLoad => {
      const uri = onPhone(src.uri) ? src.uri : shown.get(src.uri);
      return uri ? { state: 'shown', uri } : { state: 'loading' };
    };
    const [state, setState] = useState(now);
    const [attempt, setAttempt] = useState(0);
    const key = src.uri;
    useEffect(() => {
      let current = true;
      const kept = onPhone(key) ? key : shown.get(key);
      if (kept) {
        setState({ state: 'shown', uri: kept });
        return;
      }
      setState({ state: 'loading' });
      load(src).then(
        (uri) => current && setState({ state: 'shown', uri }),
        (e: unknown) => {
          // What the Mac answered (no such picture, or not one this session named) is final.
          const answered = e instanceof ApiError && !isTransient(e.status);
          if (current) setState({ state: answered ? 'gone' : 'failed' });
        },
      );
      return () => {
        current = false;
      };
      // src is a new object on every render; the picture is the same while its uri is.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, attempt]);
    return [state, () => setAttempt((n) => n + 1)];
  };
}
