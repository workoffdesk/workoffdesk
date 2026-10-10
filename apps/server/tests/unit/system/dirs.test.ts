import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRS_MAX, expandHome, listDirs } from '../../../src/system/dirs.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'ts-dirs-')));
const home = join(root, 'home');
const outside = join(root, 'outside');
for (const d of ['code/weather-app', 'code/Web-site', 'code/api', 'code/.cache', 'Documents', 'many']) mkdirSync(join(home, d), { recursive: true });
mkdirSync(join(outside, 'secret'), { recursive: true });
writeFileSync(join(home, 'code', 'README.md'), '');
writeFileSync(join(home, 'code', 'wednesday.txt'), '');
symlinkSync(outside, join(home, 'escape'));
symlinkSync(join(home, 'code', 'api'), join(home, 'api-link'));
symlinkSync(home, join(root, 'home-link'));
symlinkSync(join(home, 'code', 'README.md'), join(home, 'readme-link'));
for (let i = 0; i < DIRS_MAX + 5; i++) mkdirSync(join(home, 'many', `d${String(i).padStart(3, '0')}`));

const names = (dirs: string[]) => dirs.map((d) => d.slice(d.lastIndexOf('/') + 1));

describe('listDirs', () => {
  it('lists the folders in the part before the last slash, by name, ignoring case, and no files', async () => {
    expect(await listDirs('~/code/', home)).toEqual([join(home, 'code/api'), join(home, 'code/weather-app'), join(home, 'code/Web-site')]);
  });

  it('lists those that start with what comes after the last slash, ignoring case', async () => {
    expect(names(await listDirs('~/code/we', home))).toEqual(['weather-app', 'Web-site']);
    expect(names(await listDirs('~/code/WE', home))).toEqual(['weather-app', 'Web-site']);
  });

  it("leaves out those whose names start with '.', unless what is typed does", async () => {
    expect(names(await listDirs('~/code/', home))).not.toContain('.cache');
    expect(names(await listDirs('~/code/.', home))).toEqual(['.cache']);
  });

  it.each(['~', '~/'])('lists those in home for %s', async (typed) => {
    expect(names(await listDirs(typed, home))).toEqual(['api-link', 'code', 'Documents', 'many']);
  });

  it('finds them from a path written in full inside home', async () => {
    expect(await listDirs(`${home}/code/a`, home)).toEqual([join(home, 'code/api')]);
  });

  it('keeps the path as typed when home is reached through a link', async () => {
    const linked = join(root, 'home-link');
    expect(await listDirs('~/code/a', linked)).toEqual([join(linked, 'code/api')]);
  });

  it.each([
    ['the root', '/'],
    ['a folder outside home', `${outside}/`],
    ['the folder home is in, though home is one of its folders', `${root}/`],
    ['home left by ..', '~/../outside/'],
    ['home left by .. further in', '~/code/../../outside/'],
    ['home left by a link', '~/escape/'],
    ['a folder that does not exist', '~/nope/'],
    ['a relative path', 'code/'],
    ["another person's home", '~bob/'],
    ['nothing', ''],
  ])('lists none for %s', async (_, typed) => {
    expect(await listDirs(typed, home)).toEqual([]);
  });

  it('lists none for a relative path while the server runs inside home', async () => {
    const was = process.cwd();
    process.chdir(home);
    try {
      expect(await listDirs('code/', home)).toEqual([]);
    } finally {
      process.chdir(was);
    }
  });

  it('does not include a link that leads out of home, and does include one that stays in it', async () => {
    const listed = names(await listDirs('~/', home));
    expect(listed).not.toContain('escape');
    expect(listed).toContain('api-link');
  });

  it(`lists at most ${DIRS_MAX}`, async () => {
    const dirs = await listDirs('~/many/', home);
    expect(dirs).toHaveLength(DIRS_MAX);
    expect(names(dirs)[0]).toBe('d000');
  });
});

describe('expandHome', () => {
  it.each([
    ['~', home],
    ['~/code', join(home, 'code')],
    ['/srv/x', '/srv/x'],
    ['code', 'code'],
    ['~bob/x', '~bob/x'],
  ])('expands %s to %s', (typed, expected) => {
    expect(expandHome(typed, home)).toBe(expected);
  });
});
