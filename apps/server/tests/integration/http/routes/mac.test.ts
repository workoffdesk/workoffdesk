import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { sessionCookie } from '../../../../src/http/auth/guard.js';
import type { Check } from '../../../../src/ops/doctor.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { beginOp, readLastOp } from '../../../../src/ops/lastOp.js';
import type { OpsDeps } from '../../../../src/ops/report.js';
import { Store } from '../../../../src/system/store.js';
import { ORIGIN, RP_ID } from '../../../helpers/app.js';

const machine = { id: 'local', watch: () => () => {}, onChange: () => () => {}, listSessions: async () => [], journal: new Journal({ file: ':memory:', log: () => {} }) } as unknown as LocalMachine;

// A home with releases the way deploy leaves them, app pointing at the newest.
function homeWithReleases(names: string[]) {
  const home = mkdtempSync(join(tmpdir(), 'ts-mac-'));
  names.forEach((name, i) => {
    const dir = join(home, 'releases', name);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'workoffdesk', version: `3.0.${i}` }));
    writeFileSync(join(dir, '.complete'), JSON.stringify({ seq: i + 1 }));
    writeFileSync(join(dir, '.activated'), new Date(Date.UTC(2026, 9, 7, i)).toISOString());
  });
  if (names.length) symlinkSync(join(home, 'releases', names.at(-1)!), join(home, 'app'));
  mkdirSync(join(home, 'logs'));
  return home;
}

let app: FastifyInstance;
afterEach(() => app?.close());

async function start(o: Partial<OpsDeps> & { home: string }) {
  const spawned: string[] = [];
  const store = new Store(join(o.home, 'state.json'));
  store.update((s) => {
    s.user = { username: 'alice', hash: 'unused' };
  });
  const ops: OpsDeps = {
    managed: true,
    startedAt: 1234,
    buildRoot: join(o.home, 'nowhere'),
    doctor: async (msg) => [{ id: 'tmux', ok: false, detail: msg.doctor.notFound, fix: msg.doctor.tmuxFix } satisfies Check],
    spawnOp: (op) => {
      spawned.push(op);
      return 999_999;
    },
    ...o,
  };
  const built = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(o.home, 'audit.log'), ops });
  app = built.app;
  const cookie = sessionCookie(built.ctx.logins.create('test', 'password'), true).split(';')[0];
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie, origin: ORIGIN } });
  return { call, spawned };
}

describe('GET /api/mac and /api/mac/problems', () => {
  it('answers a signed-in device only', async () => {
    const home = homeWithReleases([]);
    await start({ home });
    expect((await app.inject({ method: 'GET', url: '/api/mac' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/mac/restart', headers: { origin: ORIGIN } })).statusCode).toBe(401);
  });

  it('says the checks in the language asked for, the build, and the releases newest first', async () => {
    const home = homeWithReleases(['20261007-100000', '20261007-110000']);
    const { call } = await start({ home });
    const r = (await call('GET', '/api/mac?lang=zh')).json();
    expect(r.checks).toEqual([{ id: 'tmux', ok: false, detail: '找不到', fix: 'brew install tmux' }]);
    expect(r.release).toBe('20261007-110000');
    expect(r.releases).toEqual([
      { name: '20261007-110000', version: '3.0.1', activatedAt: '2026-10-07T01:00:00.000Z' },
      { name: '20261007-100000', version: '3.0.0', activatedAt: '2026-10-07T00:00:00.000Z' },
    ]);
    expect(r).toMatchObject({ managed: true, startedAt: 1234, build: null, lastOp: null, rollbackTo: '20261007-100000' });
  });

  it('lists the recent warnings and errors from the log', async () => {
    const home = homeWithReleases([]);
    writeFileSync(join(home, 'logs/workoffdesk.log'), `${JSON.stringify({ level: 50, time: 0, msg: 'boom' })}\n`);
    const { call } = await start({ home });
    expect((await call('GET', '/api/mac/problems')).json()).toEqual([{ at: '1970-01-01T00:00:00.000Z', level: 'error', msg: 'boom', detail: '{}', count: 1 }]);
  });
});

describe('POST /api/mac/restart', () => {
  it('hands the restart to a helper and records it', async () => {
    const home = homeWithReleases([]);
    const { call, spawned } = await start({ home });
    expect((await call('POST', '/api/mac/restart', {})).statusCode).toBe(202);
    expect(spawned).toEqual(['restart']);
    expect(readLastOp(home)).toMatchObject({ op: 'restart', pid: 999_999 });
  });

  it('is refused when launchd does not run this server', async () => {
    const home = homeWithReleases([]);
    const { call, spawned } = await start({ home, managed: false });
    const r = await call('POST', '/api/mac/restart', {});
    expect([r.statusCode, r.json().code]).toEqual([409, 'not-managed']);
    expect(spawned).toEqual([]);
  });

  it('is refused while another restart or rollback runs', async () => {
    const home = homeWithReleases([]);
    beginOp(home, 'rollback', process.pid);
    const { call, spawned } = await start({ home });
    const r = await call('POST', '/api/mac/restart', {});
    expect([r.statusCode, r.json().code]).toEqual([409, 'op-busy']);
    expect(spawned).toEqual([]);
  });
});

describe('POST /api/mac/rollback', () => {
  it('goes to the release the screen named', async () => {
    const home = homeWithReleases(['a', 'b']);
    const { call, spawned } = await start({ home });
    expect((await call('POST', '/api/mac/rollback', { to: 'a' })).statusCode).toBe(202);
    expect(spawned).toEqual(['rollback']);
  });

  it.each([
    ['a release that is no longer the one before', ['a', 'b', 'c'], 'a'],
    ['nothing to go back to', ['a'], 'a'],
    ['no release named', ['a', 'b'], undefined],
  ])('is refused for %s', async (_, names, to) => {
    const home = homeWithReleases(names);
    const { call, spawned } = await start({ home });
    const r = await call('POST', '/api/mac/rollback', { to });
    expect([r.statusCode, r.json().code]).toEqual([409, 'rollback-moved']);
    expect(spawned).toEqual([]);
  });
});
