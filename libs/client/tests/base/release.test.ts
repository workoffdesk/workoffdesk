import { describe, expect, it } from 'vitest';
import { createReleaseWatch } from '../../src/base/release';

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
