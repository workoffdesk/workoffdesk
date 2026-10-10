import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../../../src/system/config';

const ok = { origin: 'https://workoffdesk.example.com' };

describe('parseConfig', () => {
  it('fills in what can be worked out', () => {
    expect(parseConfig(ok)).toEqual({
      port: 7681,
      origin: 'https://workoffdesk.example.com',
      rpId: 'workoffdesk.example.com',
      pinnedDirs: [],
      serviceLabel: 'local.workoffdesk',
      claudeArgs: [],
      preventSleep: true,
    });
  });

  it('prevents sleep unless told not to', () => {
    expect(parseConfig(ok).preventSleep).toBe(true);
    expect(parseConfig({ ...ok, preventSleep: false }).preventSleep).toBe(false);
    expect(() => parseConfig({ ...ok, preventSleep: 'no' })).toThrow(ConfigError);
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:7681', 'http://localhost'])('takes %s for working on it locally', (origin) => {
    expect(parseConfig({ origin }).origin).toBe(origin);
  });

  it.each([
    ['origin', {}],
    ['origin', null],
    ['origin', { origin: 'http://workoffdesk.example.com' }],
    ['origin', { origin: 'workoffdesk.example.com' }],
    ['origin', { origin: 'https://workoffdesk.example.com/path' }],
    ['port', { ...ok, port: 0 }],
    ['port', { ...ok, port: 70000 }],
    ['port', { ...ok, port: 1.5 }],
    ['port', { ...ok, port: '7681' }],
    ['rpId', { ...ok, rpId: 'other.com' }],
    ['rpId', { ...ok, rpId: 'ample.com' }],
    ['pinnedDirs', { ...ok, pinnedDirs: 'x' }],
    ['pinnedDirs', { ...ok, pinnedDirs: [1] }],
    ['serviceLabel', { ...ok, serviceLabel: 'has space' }],
    ['serviceLabel', { ...ok, serviceLabel: '' }],
    ['claudeArgs', { ...ok, claudeArgs: '--chrome' }],
    ['claudeArgs', { ...ok, claudeArgs: [true] }],
  ])('refuses a bad %s, naming it', (field, raw) => {
    const e = (() => {
      try {
        parseConfig(raw);
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as ConfigError).field).toBe(field);
    expect((e as ConfigError).message).toContain(field);
  });

  it("accepts an rpId the origin's host ends with", () => {
    expect(parseConfig({ origin: 'https://workoffdesk.example.com', rpId: 'example.com' }).rpId).toBe('example.com');
  });
});

describe('loadConfig', () => {
  it('loads a v1 config file unchanged in behavior', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-cfg-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ port: 7681, hostname: 'workoffdesk.example.com', origin: 'https://workoffdesk.example.com', rpId: 'workoffdesk.example.com', pinnedDirs: ['/a'] }),
    );
    expect(loadConfig(home)).toEqual({
      port: 7681,
      origin: 'https://workoffdesk.example.com',
      rpId: 'workoffdesk.example.com',
      pinnedDirs: ['/a'],
      serviceLabel: 'local.workoffdesk',
      claudeArgs: [],
      preventSleep: true,
    });
  });

  it('asks for setup when there is no config yet', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-cfg-'));
    expect(() => loadConfig(home)).toThrow(/setup/);
  });

  it('says the file is not JSON, rather than blaming a field', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-cfg-'));
    writeFileSync(join(home, 'config.json'), '{ port: 7681');
    expect(() => loadConfig(home)).toThrow(ConfigError);
    expect(() => loadConfig(home)).toThrow(/JSON/);
  });
});
