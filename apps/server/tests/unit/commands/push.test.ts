import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { push, type PushIO } from '../../../src/commands/push.js';
import { startControlServer } from '../../../src/sessions/control.js';
import { en } from '../../../src/system/messages.js';
import { socketDir } from '../../helpers/socketDir.js';

// `workoffdesk push <title> <body>`: a plain message to every registered device.
const dir = socketDir('psh');
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const io = (sock: string, more: Partial<PushIO> = {}): PushIO => ({
  sock,
  fail: (m) => Promise.reject(new Error(`failed: ${m}`)),
  ...more,
});

describe('push', () => {
  it.each([
    ['no words', []],
    ['a title alone', ['Heads up']],
    ['an empty title', ['', 'Lunch']],
    ['an empty body', ['Heads up', '']],
    ['more words than a title and a body', ['Heads up', 'Lunch', 'now']],
  ])('says how to use it for %s, and does not ask the service', async (_name, args) => {
    await expect(push(args, io('/nowhere'))).rejects.toThrow(en.cli.pushUsage);
  });

  it('says the service is not running when nothing listens', async () => {
    const sock = join(mkdtempSync(join(dir, 'n-')), 'sock');
    await expect(push(['Heads up', 'Lunch'], io(sock))).rejects.toThrow(en.cli.notRunning);
  });

  it('hands the title and the body to the running service', async () => {
    const sock = join(mkdtempSync(join(dir, 's-')), 'sock');
    const pushed: [string, string][] = [];
    servers.push(
      await startControlServer(sock, {
        open: async () => 'x',
        accounts: { view: async () => ({}) as never, pick: async () => ({}) as never, move: async () => ({}) as never },
        activity: { working: () => 0, onChange: () => () => {} },
        push: async (title, body) => void pushed.push([title, body]),
      }),
    );
    await push(['Heads up', 'Lunch'], io(sock));
    expect(pushed).toEqual([['Heads up', 'Lunch']]);
  });
});
