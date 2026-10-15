import { describe, expect, it } from 'vitest';
import { createReleaseWatch, MIN_SERVER, serverTooOld } from '../../src/base/release';

describe('createReleaseWatch', () => {
  it('tells when the release moves on, not when it is first seen or seen again', () => {
    const watch = createReleaseWatch();
    const heard: string[] = [];
    watch.subscribe((v) => heard.push(v));
    watch.saw('2.17.17');
    watch.saw('2.17.17');
    expect(heard).toEqual([]);
    watch.saw('2.17.18');
    watch.saw('2.17.18');
    watch.saw('2.17.19');
    expect(heard).toEqual(['2.17.18', '2.17.19']);
  });

  it('stops telling a listener that has left', () => {
    const watch = createReleaseWatch();
    const heard: string[] = [];
    const leave = watch.subscribe((v) => heard.push(v));
    watch.saw('1');
    leave();
    watch.saw('2');
    expect(heard).toEqual([]);
  });
});

describe('serverTooOld', () => {
  it.each([
    ['1.0.0', '1.0.1', true],
    ['0.9.12', '1.0.1', true],
    ['1.0.1', '1.0.1', false],
    ['1.0.2', '1.0.1', false],
    ['1.1.0', '1.0.9', false],
    ['2.0.0', '1.10.0', false],
    ['1.0.10', '1.0.9', false],
    ['1.0.1-stage', '1.0.1', true],
    ['0.0.0-stage', '1.0.1', true],
  ])('a server of %s for a client that needs %s: %s', (server, min, old) => {
    expect(serverTooOld(server, min)).toBe(old);
  });

  it.each([[''], ['dev'], ['1.0'], ['v1.0.1x']])('says nothing of a release it cannot read: %j', (server) => {
    expect(serverTooOld(server, '1.0.1')).toBe(false);
  });

  it('needs a release this client works against', () => {
    expect(MIN_SERVER).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('createReleaseWatch: the release now', () => {
  it('is known from the first answer, and every change is told to those that follow it', () => {
    const watch = createReleaseWatch();
    const seen: string[] = [];
    expect(watch.current()).toBeNull();
    watch.follow(() => seen.push(watch.current()!));
    watch.saw('1.0.0');
    watch.saw('1.0.0');
    watch.saw('1.0.2');
    expect(seen).toEqual(['1.0.0', '1.0.2']);
  });
});

describe('createReleaseWatch: another server', () => {
  it('forgets the release of the server it leaves, and does not take the next one for a move on', () => {
    const watch = createReleaseWatch();
    const moved: string[] = [];
    let told = 0;
    watch.subscribe((v) => moved.push(v));
    watch.follow(() => told++);
    watch.saw('1.0.0');
    watch.forget();
    expect(watch.current()).toBeNull();
    expect(told).toBe(2);
    watch.saw('1.0.3');
    expect(moved).toEqual([]);
    expect(watch.current()).toBe('1.0.3');
  });
});
