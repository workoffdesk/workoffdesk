import { ApiError, type ApiInit } from '../base/api';

// A file sent from the phone in parts (apps/server/src/uploads/fileUpload.ts): each goes where the Mac's copy ends,
// and after a failure the Mac is asked where that is, so a dropped line costs one part, not the file.
export type Frames = { dir: string; count: number; every: number };
export type FileSent = { path: string; frames: Frames | null };

type Api = <T>(path: string, init?: ApiInit) => Promise<T>;

// Under the Mac's limit for a part, and under what a slow line sends in its time limit.
const PART = 2 * 1024 * 1024;
// Failures in a row, with no byte getting through, before the file is given up on.
const GIVE_UP_AFTER = 8;
const WAIT_MS = [1000, 2000, 4000, 8000, 15_000];

const ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const newUploadId = () => Array.from({ length: 24 }, () => ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)]).join('');

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function sendFile(
  api: Api,
  // A browser's File reads a part only later; the phone's, at once.
  file: { id: string; name: string; size: number; read: (at: number, length: number) => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>> },
  progress: (sent: number) => void,
): Promise<FileSent> {
  const parts = `/api/uploads/parts/${file.id}`;
  const held = async () => (await api<{ size: number }>(parts)).size;
  let sent = await held().catch(() => 0);
  let failures = 0;
  while (sent < file.size) {
    try {
      const body = await file.read(sent, Math.min(PART, file.size - sent));
      const at = sent;
      sent = (await api<{ size: number }>(parts, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'upload-offset': String(at) }, body })).size;
      failures = 0;
      progress(sent);
    } catch (e) {
      // Refused for what it is (too large, signed out), not for the line or for where it went.
      if (e instanceof ApiError && e.status < 500 && e.status !== 409 && e.status !== 408 && e.status !== 429) throw e;
      if (++failures >= GIVE_UP_AFTER) throw e;
      await wait(WAIT_MS[Math.min(failures, WAIT_MS.length) - 1]);
      sent = await held().catch(() => sent);
      progress(sent);
    }
  }
  return api<FileSent>(`${parts}/done`, { method: 'POST', json: { name: file.name, size: file.size }, idempotent: true });
}
