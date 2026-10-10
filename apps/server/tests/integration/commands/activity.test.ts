import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activity, type ActivityIO } from '../../../src/commands/activity.js';
import { startControlServer } from '../../../src/sessions/control.js';
import { en } from '../../../src/system/messages.js';
import { socketDir } from '../../helpers/socketDir.js';

// `workoffdesk activity --json`, what the menu bar app runs to know when sessions are working.
const dir = socketDir('act');
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const serve = async (working: () => number) => {
  const sock = join(mkdtempSync(join(dir, 's-')), 'sock');
  const server = await startControlServer(sock, {
    open: async () => 'x',
    accounts: { view: async () => ({}) as never, pick: async () => ({}) as never, move: async () => ({}) as never },
    activity: { working, onChange: () => () => {} },
  });
  servers.push(server);
  return { sock, server };
};

const io = (sock: string, more: Partial<ActivityIO> = {}): ActivityIO => ({
  sock,
  print: () => {},
  fail: (m) => Promise.reject(new Error(`failed: ${m}`)),
  orphaned: () => false,
  ...more,
});

describe('activity', () => {
  it('prints the working count as a line of JSON, and ends with the server', async () => {
    const { sock, server } = await serve(() => 2);
    const lines: string[] = [];
    const ran = activity(['--json'], io(sock, { print: (l) => lines.push(l) }));
    await vi.waitFor(() => expect(lines).toEqual(['{"working":2}']));
    server.closeAllConnections();
    await ran;
  });

  it('says the service is not running when nothing listens', async () => {
    const sock = join(mkdtempSync(join(dir, 'n-')), 'sock');
    await expect(activity(['--json'], io(sock))).rejects.toThrow(en.cli.notRunning);
  });

  it('asks for --json, which is all it prints', async () => {
    await expect(activity([], io('/nowhere'))).rejects.toThrow(en.cli.activityUsage);
  });

  // The menu bar app quitting or crashing does not end it: nothing reads its lines, and it would wait for good.
  it('ends once the app that ran it is gone', async () => {
    const { sock } = await serve(() => 0);
    let gone = false;
    const lines: string[] = [];
    const ran = activity(['--json'], io(sock, { print: (l) => lines.push(l), orphaned: () => gone, checkMs: 20 }));
    await vi.waitFor(() => expect(lines).toEqual(['{"working":0}']));
    gone = true;
    await ran;
  });

  // A server from before `activity`, as during a deploy: one line that says so, not a stack trace.
  it('says what the server answered when it cannot', async () => {
    const sock = join(mkdtempSync(join(dir, 'o-')), 'sock');
    const server = createServer((_req, res) => ((res.statusCode = 404), res.end('{}')));
    await new Promise<void>((r) => server.listen(sock, r));
    servers.push(server);
    await expect(activity(['--json'], io(sock))).rejects.toThrow('failed: server answered 404');
  });
});
