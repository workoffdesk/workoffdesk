import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTranscript } from '../../../../../src/agents/claude/transcript/watch.js';

// A session's transcript watched on disk, as Claude Code writes it: under a folder per project, named by
// the conversation's id. Real files and real timers: it looks for a missing transcript every second.
const ONE = '6f1c2a3b-0000-4000-8000-000000000001';
const TWO = '6f1c2a3b-0000-4000-8000-000000000002';
const WAIT = { timeout: 5000, interval: 25 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});
const watched = (sid: () => string | undefined = () => ONE) => {
  const root = mkdtempSync(join(tmpdir(), 'ts-projects-'));
  mkdirSync(join(root, '-work-app'));
  const file = (id: string) => join(root, '-work-app', `${id}.jsonl`);
  let told = 0;
  const stop = watchTranscript(root, sid, () => told++);
  stops.push(stop);
  return { file, told: () => told, stop };
};
// Told once more than `n`, and no more after the writes settle.
const toldAfter = async (w: { told: () => number }, n: number) => {
  await vi.waitFor(() => expect(w.told()).toBeGreaterThan(n), WAIT);
  await sleep(300);
  return w.told();
};

describe('watchTranscript', () => {
  it('tells when it is written to, once for writes in a row, and not while it is not', async () => {
    const w = watched();
    writeFileSync(w.file(ONE), '{}\n');
    const found = await toldAfter(w, 0);
    for (let i = 0; i < 5; i++) {
      appendFileSync(w.file(ONE), '{}\n');
      await sleep(30);
    }
    expect(await toldAfter(w, found)).toBe(found + 1);
    await sleep(2200);
    expect(w.told()).toBe(found + 1);
  });

  it('finds it once a new session writes it, and tells then', async () => {
    const w = watched();
    await sleep(1200);
    expect(w.told()).toBe(0);
    writeFileSync(w.file(ONE), '{}\n');
    const found = await toldAfter(w, 0);
    appendFileSync(w.file(ONE), '{}\n');
    await toldAfter(w, found);
  });

  it('finds it again when it is replaced by a new file', async () => {
    const w = watched();
    writeFileSync(w.file(ONE), '{}\n');
    const before = await toldAfter(w, 0);
    writeFileSync(`${w.file(ONE)}.tmp`, '{}\n{}\n');
    renameSync(`${w.file(ONE)}.tmp`, w.file(ONE));
    const replaced = await toldAfter(w, before);
    await sleep(1200);
    const found = w.told();
    appendFileSync(w.file(ONE), '{}\n');
    expect(await toldAfter(w, found)).toBeGreaterThan(replaced);
  });

  it('follows the session to another conversation, and no longer tells of the one it left', async () => {
    let sid = ONE;
    const w = watched(() => sid);
    writeFileSync(w.file(ONE), '{}\n');
    writeFileSync(w.file(TWO), '{}\n');
    const first = await toldAfter(w, 0);
    sid = TWO;
    const moved = await toldAfter(w, first);
    appendFileSync(w.file(ONE), '{}\n');
    await sleep(400);
    expect(w.told()).toBe(moved);
    appendFileSync(w.file(TWO), '{}\n');
    await toldAfter(w, moved);
  });

  it('waits for a session that has no conversation yet', async () => {
    const session: { sid?: string } = {};
    const w = watched(() => session.sid);
    writeFileSync(w.file(ONE), '{}\n');
    await sleep(1200);
    expect(w.told()).toBe(0);
    session.sid = ONE;
    await toldAfter(w, 0);
  });

  it('tells nothing once stopped, a write it was settling included', async () => {
    const w = watched();
    writeFileSync(w.file(ONE), '{}\n');
    const found = await toldAfter(w, 0);
    appendFileSync(w.file(ONE), '{}\n');
    await vi.waitFor(() => expect(w.told()).toBe(found + 1), WAIT);
    appendFileSync(w.file(ONE), '{}\n');
    await sleep(20);
    w.stop();
    await sleep(1200);
    appendFileSync(w.file(ONE), '{}\n');
    await sleep(300);
    expect(w.told()).toBe(found + 1);
  });

  it('tells nothing once stopped while it was still looking', async () => {
    const w = watched();
    w.stop();
    writeFileSync(w.file(ONE), '{}\n');
    await sleep(1300);
    expect(w.told()).toBe(0);
  });
});
