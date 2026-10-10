import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { writeBuildStamp, type BuildStamp } from '../../../src/ops/build';
import { deploy, healthOn, launchEntry, listReleases, migrateLayout, rollback } from '../../../src/ops/release';

const COMMIT = '5cb8e44a1d2f3b4c5d6e7f8091a2b3c4d5e6f708';
// A build of `version` whose dist the build stamped as built from `stamp` (by default the same version),
// or left unstamped, as a build that failed partway does.
const build = (version: string, stamp: Partial<BuildStamp> | null = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'ts-src-'));
  mkdirSync(join(d, 'dist/server'), { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(d, 'dist/server/cli.js'), '');
  mkdirSync(join(d, 'dist/server/routes'), { recursive: true });
  writeFileSync(join(d, 'dist/server/routes/health.js'), '');
  if (stamp) writeBuildStamp(d, { version, commit: COMMIT, dirty: false, ...stamp });
  return d;
};
const RUNTIME = 'e67e787c4688fa7a685dcf54c00601de3afa3b43';
// The build, with an iPhone app update for `runtime` in it.
const forRuntime = (d: string, runtime: string) => {
  mkdirSync(join(d, 'dist/app-update/ios'), { recursive: true });
  writeFileSync(join(d, 'dist/app-update/ios/update.json'), JSON.stringify({ runtimeVersion: runtime }));
  return d;
};
// A restart asks launchd whether the service runs before it kicks it, so it is counted by its kickstart.
const restarts = (calls: string[][]) => calls.filter((c) => c[0] === 'launchctl' && c[1] === 'kickstart').length;
const setup = (o: { smoke?: boolean; healthy?: (v: string | null) => boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'ts-home-'));
  const calls: string[][] = [];
  let t = 0;
  const deps = {
    home, label: 'local.workoffdesk', uid: 501,
    exec: async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { code: 0, out: '' }; },
    smoke: async () => o.smoke ?? true,
    health: async (v: string | null) => (o.healthy ?? (() => true))(v),
    now: () => new Date(Date.UTC(2026, 9, 4, 12, 0, t++)),
  };
  return { home, calls, deps, current: () => readlinkSync(join(home, 'app')) };
};

// A service that is running: launchctl print shows its pid until it has stopped.
const running = (s: ReturnType<typeof setup>, o: { stops: boolean }) => {
  let alive = true;
  s.deps.exec = async (cmd: string, args: string[]) => {
    s.calls.push([cmd, ...args]);
    if (args[0] === 'kill' && o.stops) alive = false;
    if (args[0] === 'kickstart') alive = true;
    return { code: 0, out: args[0] === 'print' && alive ? 'state = running\n\tpid = 4242\n' : '' };
  };
};
const kicks = (calls: string[][]) => calls.filter((c) => c[0] === 'launchctl' && c[1] === 'kickstart').map((c) => c.slice(2));

describe('deploy', () => {
  it('puts the build in a release of its own, points app at it and restarts the service', async () => {
    const s = setup();
    const r = await deploy(build('2.0.0'), s.deps);
    expect(r.ok).toBe(true);
    expect(lstatSync(join(s.home, 'app')).isSymbolicLink()).toBe(true);
    expect(s.current()).toBe(join(s.home, 'releases', r.release));
    expect(s.calls).toContainEqual(['launchctl', 'kickstart', 'gui/501/local.workoffdesk']);
  });

  it('leaves the running build alone when the new one fails its smoke test', async () => {
    const s = setup();
    const first = await deploy(build('1.0.0'), s.deps);
    s.deps.smoke = async () => false;
    const r = await deploy(build('2.0.0'), s.deps);
    expect(r.ok).toBe(false);
    expect(s.current()).toBe(join(s.home, 'releases', first.release));
    expect(restarts(s.calls)).toBe(1);
    expect(listReleases(s.home)).toEqual([first.release]);
  });

  it('goes back to the build before when the new one does not come up healthy', async () => {
    const s = setup({ healthy: (v) => v !== '2.0.0' });
    const first = await deploy(build('1.0.0'), s.deps);
    const r = await deploy(build('2.0.0'), s.deps);
    expect(r.ok).toBe(false);
    expect(s.current()).toBe(join(s.home, 'releases', first.release));
    expect(restarts(s.calls)).toBe(3);
  });

  it('keeps the newest three releases', async () => {
    const s = setup();
    for (const v of ['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4']) await deploy(build(v), s.deps);
    expect(listReleases(s.home)).toHaveLength(3);
  });

  it('never prunes the build it replaced, even when newer releases were put there by hand', async () => {
    const s = setup();
    const first = await deploy(build('1.0.0'), s.deps);
    for (const [name, seq] of [['20990101-000001', 5], ['20990101-000002', 6], ['20990101-000003', 7]] as const) {
      mkdirSync(join(s.home, 'releases', name, 'dist/server'), { recursive: true });
      writeFileSync(join(s.home, 'releases', name, 'package.json'), JSON.stringify({ version: '9.9.9' }));
      writeFileSync(join(s.home, 'releases', name, '.complete'), JSON.stringify({ seq }));
    }
    const r = await deploy(build('2.0.0'), s.deps);
    expect(r.ok).toBe(true);
    expect(existsSync(join(s.home, 'releases', first.release, 'package.json'))).toBe(true);
    expect(listReleases(s.home)[0]).toBe(r.release);
  });

  it('never prunes the running build when the newer ones are failed deploys', async () => {
    const s = setup();
    const first = await deploy(build('1.0.0'), s.deps);
    s.deps.health = async () => false;
    for (const v of ['1.0.1', '1.0.2', '1.0.3']) await deploy(build(v), s.deps);
    expect(s.current()).toBe(join(s.home, 'releases', first.release));
    expect(listReleases(s.home)).toEqual([first.release]);
  });

  it('ignores a release without a complete marker, and clears it away', async () => {
    const s = setup();
    await deploy(build('1.0.0'), s.deps);
    mkdirSync(join(s.home, 'releases', '20990101-000000.partial'), { recursive: true });
    mkdirSync(join(s.home, 'releases', '20990101-000001'), { recursive: true });
    expect(listReleases(s.home)).toHaveLength(1);
    await deploy(build('1.0.1'), s.deps);
    expect(readdirSync(join(s.home, 'releases')).some((n) => n.endsWith('.partial'))).toBe(false);
  });

  it('leaves no app behind when the very first build does not come up', async () => {
    const s = setup({ healthy: () => false });
    const r = await deploy(build('1.0.0'), s.deps);
    expect(r.ok).toBe(false);
    expect(() => lstatSync(join(s.home, 'app'))).toThrow();
    expect(listReleases(s.home)).toHaveLength(0);
  });

  it('says which iPhone runtime the release has an app update for, or that it has none', async () => {
    const s = setup();
    const a = await deploy(forRuntime(build('2.0.0'), RUNTIME), s.deps);
    expect(a.message).toContain(RUNTIME);
    expect(a.message).not.toMatch(/no iPhone app update/);
    const b = await deploy(build('2.0.1'), s.deps, { newAppRuntime: true });
    expect(b.ok).toBe(true);
    expect(b.message).toMatch(/no iPhone app update/);
  });

  // Phones run the runtime of the app they have installed, and are served updates for that one only.
  describe('with a build whose iPhone update is for another runtime than the live one', () => {
    const OTHER = '0123456789abcdef0123456789abcdef01234567';
    const live = async () => {
      const s = setup();
      const first = await deploy(forRuntime(build('1.0.0'), RUNTIME), s.deps);
      expect(first.ok).toBe(true);
      return { s, first };
    };

    it.each<[string, (d: string) => string, RegExp]>([
      ['for a runtime of its own', (d) => forRuntime(d, OTHER), new RegExp(`${RUNTIME}[^]*but this build's is for ${OTHER}`)],
      ['with no update at all', (d) => d, /is missing \(was WORKOFFDESK_IOS_BUNDLE_ID set\?\)/],
    ])('does not deploy it, %s, and the live one goes on untouched', async (_, made, says) => {
      const { s, first } = await live();
      const r = await deploy(made(build('2.0.0')), s.deps);
      expect(r).toMatchObject({ ok: false, release: '' });
      expect(r.message).toMatch(says);
      expect(r.message).toContain('--new-app-runtime');
      expect(s.current()).toBe(join(s.home, 'releases', first.release));
      expect(listReleases(s.home)).toEqual([first.release]);
      expect(restarts(s.calls)).toBe(1);
    });

    it('deploys it once a new build of the app is out', async () => {
      const { s } = await live();
      const r = await deploy(forRuntime(build('2.0.0'), OTHER), s.deps, { newAppRuntime: true });
      expect(r.ok).toBe(true);
      expect(s.current()).toBe(join(s.home, 'releases', r.release));
      expect(r.message).toContain(OTHER);
    });

    it.each<[string, (s: ReturnType<typeof setup>) => Promise<unknown>]>([
      ['the live one', async (s) => deploy(forRuntime(build('1.0.0'), RUNTIME), s.deps)],
      ['no live one', async () => undefined],
      ['a live one with no update', async (s) => deploy(build('1.0.0'), s.deps)],
    ])('does not stand in the way of an update for the same runtime as %s', async (_, before) => {
      const s = setup();
      await before(s);
      expect((await deploy(forRuntime(build('2.0.0'), RUNTIME), s.deps)).ok).toBe(true);
    });
  });

  describe('with a dist not built from the version the build claims', () => {
    it.each([
      ['built for an older version, left over from an earlier build', { version: '2.17.3' }],
      ['built for a newer version', { version: '2.17.5' }],
      ['with no stamp, as a build that failed partway leaves it', null],
    ])('refuses it when it was %s, before anything is touched', async (_, stamp) => {
      const s = setup();
      const first = await deploy(build('2.17.3'), s.deps);
      expect(first.ok).toBe(true);
      const callsBefore = s.calls.length;
      const smoke = vi.fn(async () => true);
      s.deps.smoke = smoke;
      const r = await deploy(build('2.17.4', stamp), s.deps);
      expect(r.ok).toBe(false);
      expect(r.message).toContain('2.17.4');
      if (stamp) expect(r.message).toContain(stamp.version);
      expect(smoke).not.toHaveBeenCalled();
      expect(s.calls).toHaveLength(callsBefore);
      expect(s.current()).toBe(join(s.home, 'releases', first.release));
      expect(listReleases(s.home)).toEqual([first.release]);
    });

    it('does not refuse one whose stamp names the same version', async () => {
      const s = setup();
      expect((await deploy(build('2.17.4', { version: '2.17.4' }), s.deps)).ok).toBe(true);
    });
  });

  it('says which commit the release was built from, and whether the tree had changes beyond it', async () => {
    const s = setup();
    const clean = await deploy(build('2.0.0'), s.deps);
    expect(clean.message).toContain(COMMIT.slice(0, 12));
    expect(clean.message).not.toMatch(/uncommitted/);
    const dirty = await deploy(build('2.0.1', { dirty: true }), s.deps);
    expect(dirty.message).toContain(COMMIT.slice(0, 12));
    expect(dirty.message).toMatch(/uncommitted/);
    const outside = await deploy(build('2.0.2', { commit: null }), s.deps);
    expect(outside.ok).toBe(true);
    expect(outside.message).toMatch(/outside git/);
  });

  it('refuses a source that is not a build', async () => {
    const s = setup();
    const empty = mkdtempSync(join(tmpdir(), 'ts-src-'));
    const r = await deploy(empty, s.deps);
    expect(r.ok).toBe(false);
    expect(s.calls).toHaveLength(0);
    expect(existsSync(join(s.home, 'app'))).toBe(false);
  });

  describe('when restarting a running service', () => {
    // The wait for a service to stop is time, which a fake clock skips.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const deployed = async (s: ReturnType<typeof setup>) => {
      const done = deploy(build('2.0.0'), s.deps);
      await vi.runAllTimersAsync();
      return done;
    };

    it('asks it to stop, and starts it without killing it once it has', async () => {
      const s = setup();
      running(s, { stops: true });
      expect((await deployed(s)).ok).toBe(true);
      expect(s.calls).toContainEqual(['launchctl', 'kill', 'SIGTERM', 'gui/501/local.workoffdesk']);
      expect(kicks(s.calls)).toEqual([['gui/501/local.workoffdesk']]);
    });

    it('kills one that does not stop within the time it is given', async () => {
      const s = setup();
      running(s, { stops: false });
      expect((await deployed(s)).ok).toBe(true);
      expect(s.calls).toContainEqual(['launchctl', 'kill', 'SIGTERM', 'gui/501/local.workoffdesk']);
      expect(kicks(s.calls)).toEqual([['-k', 'gui/501/local.workoffdesk']]);
    });
  });
});

describe('migrateLayout', () => {
  it('turns the app and app.old folders of v1 into releases, app pointing where it did', () => {
    const s = setup();
    mkdirSync(join(s.home, 'app/dist'), { recursive: true });
    writeFileSync(join(s.home, 'app/package.json'), JSON.stringify({ version: '0.1.0' }));
    mkdirSync(join(s.home, 'app.old/dist'), { recursive: true });
    migrateLayout(s.home);
    expect(lstatSync(join(s.home, 'app')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(s.home, 'app/package.json'))).toBe(true);
    expect(existsSync(join(s.home, 'app.old'))).toBe(false);
    expect(listReleases(s.home)).toHaveLength(2);
    migrateLayout(s.home);
    expect(listReleases(s.home)).toHaveLength(2);
  });
});

describe('rollback', () => {
  it('points app at the release before and restarts', async () => {
    const s = setup();
    const first = await deploy(build('1.0.0'), s.deps);
    await deploy(build('2.0.0'), s.deps);
    const r = await rollback(s.deps);
    expect(r.ok).toBe(true);
    expect(s.current()).toBe(join(s.home, 'releases', first.release));
    expect(restarts(s.calls)).toBe(3);
  });

  // v1 has no /healthz, so it can only be asked whether it answers at all.
  it('goes back to the v1 build, which cannot report its version', async () => {
    const s = setup({ healthy: (v) => v !== '0.1.0' });
    mkdirSync(join(s.home, 'app/dist/server'), { recursive: true });
    writeFileSync(join(s.home, 'app/package.json'), JSON.stringify({ version: '0.1.0' }));
    writeFileSync(join(s.home, 'app/dist/server/cli.js'), '');
    expect((await deploy(build('2.0.0'), s.deps)).ok).toBe(true);
    const r = await rollback(s.deps);
    expect(r.ok, r.message).toBe(true);
    expect(s.current()).toBe(join(s.home, 'releases', 'v1-current'));
  });

  it('says so when there is nothing to go back to', async () => {
    const s = setup();
    await deploy(build('1.0.0'), s.deps);
    expect((await rollback(s.deps)).ok).toBe(false);
  });

  it('switches back again when the older build does not come up', async () => {
    const s = setup({ healthy: (v) => v !== '1.0.0' || restarts(s.calls) < 2 });
    expect((await deploy(build('1.0.0'), s.deps)).ok).toBe(true);
    const second = await deploy(build('2.0.0'), s.deps);
    const r = await rollback(s.deps);
    expect(r.ok).toBe(false);
    expect(s.current()).toBe(join(s.home, 'releases', second.release));
    expect(restarts(s.calls)).toBe(4);
  });
});

// The app update a release serves is dated by when it began to be served, so a phone takes a rollback
// as newer than what it runs. The service reads the time at start, so it is there before the restart.
describe('deploy and rollback', () => {
  const activated = (s: ReturnType<typeof setup>, release: string) => readFileSync(join(s.home, 'releases', release, '.activated'), 'utf8');
  const atRestart = (s: ReturnType<typeof setup>) => {
    const seen: (string | null)[] = [];
    const exec = s.deps.exec;
    s.deps.exec = async (cmd, args) => {
      if (args[0] === 'kickstart') seen.push(existsSync(join(s.current(), '.activated')) ? readFileSync(join(s.current(), '.activated'), 'utf8') : null);
      return exec(cmd, args);
    };
    return seen;
  };

  it('writes the activation time into a release before the restart that starts it', async () => {
    const s = setup();
    const seen = atRestart(s);
    const r = await deploy(build('1.0.0'), s.deps);
    expect(seen).toEqual([activated(s, r.release)]);
    expect(new Date(activated(s, r.release)).toISOString()).toBe(activated(s, r.release));
  });

  it('writes it again when a rollback starts an older release, later than the newer one', async () => {
    const s = setup();
    const first = await deploy(build('1.0.0'), s.deps);
    const before = activated(s, first.release);
    const second = await deploy(build('2.0.0'), s.deps);
    const seen = atRestart(s);
    expect((await rollback(s.deps)).ok).toBe(true);
    expect(seen).toEqual([activated(s, first.release)]);
    expect(activated(s, first.release) > activated(s, second.release)).toBe(true);
    expect(activated(s, first.release) > before).toBe(true);
  });

  it('leaves it alone on the release that keeps serving when a new one does not come up', async () => {
    const s = setup({ healthy: (v) => v !== '2.0.0' });
    const first = await deploy(build('1.0.0'), s.deps);
    const before = activated(s, first.release);
    expect((await deploy(build('2.0.0'), s.deps)).ok).toBe(false);
    expect(activated(s, first.release)).toBe(before);
  });

  it('does not carry it over from the source a build was deployed from', async () => {
    const s = setup();
    const src = build('1.0.0');
    writeFileSync(join(src, '.activated'), '2000-01-01T00:00:00.000Z');
    const r = await deploy(src, s.deps);
    expect(activated(s, r.release)).not.toBe('2000-01-01T00:00:00.000Z');
  });
});

// Node starts a script by its real path, so a cli run through the app link sees the release it is in.
describe('launchEntry', () => {
  const deployed = async () => {
    const s = setup();
    const r = await deploy(build('2.0.0'), s.deps);
    const real = realpathSync(join(s.home, 'app/dist/server/cli.js'));
    expect(real, 'precondition: the real path names the release, not the link').toContain(`/releases/${r.release}/`);
    return { ...s, release: r.release, real };
  };

  it('starts a cli that lives in a release of this home through the app link, so a later deploy is what runs', async () => {
    const s = await deployed();
    expect(launchEntry(s.real, s.home)).toBe(join(s.home, 'app/dist/server/cli.js'));
  });

  it('does the same for a release app does not point at', async () => {
    const s = await deployed();
    const second = await deploy(build('2.1.0'), s.deps);
    expect(second.ok).toBe(true);
    expect(launchEntry(s.real, s.home)).toBe(join(s.home, 'app/dist/server/cli.js'));
  });

  it('matches when home itself is reached through a link', async () => {
    const s = await deployed();
    const linked = join(mkdtempSync(join(tmpdir(), 'ts-link-')), 'home');
    symlinkSync(s.home, linked);
    expect(launchEntry(s.real, linked)).toBe(join(linked, 'app/dist/server/cli.js'));
  });

  it.each([
    ['installed with npm', '/usr/local/lib/node_modules/workoffdesk/dist/server/cli.js'],
    ['in a folder whose name only starts like the releases folder', 'releases-old/r1/dist/server/cli.js'],
  ])('leaves a cli %s where it is', async (_name, path) => {
    const s = await deployed();
    const cli = path.startsWith('/') ? path : join(realpathSync(s.home), path);
    expect(launchEntry(cli, s.home)).toBe(cli);
  });

  it('leaves the cli where it is when home has no releases yet', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-home-'));
    expect(launchEntry('/srv/workoffdesk/dist/server/cli.js', home)).toBe('/srv/workoffdesk/dist/server/cli.js');
  });
});

describe('healthOn', () => {
  const serving = async (status: number, body: string) => {
    const server = createServer((_q, res) => res.writeHead(status, { 'content-type': 'application/json' }).end(body));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { port: (server.address() as { port: number }).port, close: () => server.close() };
  };

  it('wants the version asked for when one is given', async () => {
    const s = await serving(200, JSON.stringify({ ok: true, version: '2.0.0' }));
    try {
      expect(await healthOn(s.port, 1500)('2.0.0')).toBe(true);
      expect(await healthOn(s.port, 1500)('2.1.0')).toBe(false);
    } finally {
      s.close();
    }
  });

  it('takes any answer for a build that has no /healthz', async () => {
    const s = await serving(404, 'not found');
    try {
      expect(await healthOn(s.port, 1500)(null)).toBe(true);
      expect(await healthOn(s.port, 1500)('2.0.0'), 'precondition: a 404 is not a healthy v2').toBe(false);
    } finally {
      s.close();
    }
  });

  it('says no when nothing listens', async () => {
    const s = await serving(200, '{}');
    s.close();
    expect(await healthOn(s.port, 1200)(null)).toBe(false);
  });
});
