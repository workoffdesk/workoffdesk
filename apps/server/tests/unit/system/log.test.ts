import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RotatingFile, createLogger } from '../../../src/system/log';

describe('RotatingFile', () => {
  it('moves the log aside when it is full, keeping only so many old ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    const f = new RotatingFile(join(dir, 'server.log'), { maxBytes: 100, keep: 2 });
    for (let i = 0; i < 50; i++) f.write(`${'x'.repeat(30)} ${i}\n`);
    expect(statSync(join(dir, 'server.log')).size).toBeLessThanOrEqual(100);
    expect(existsSync(join(dir, 'server.log.1'))).toBe(true);
    expect(existsSync(join(dir, 'server.log.2'))).toBe(true);
    expect(existsSync(join(dir, 'server.log.3'))).toBe(false);
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toContain(' 49\n');
  });

  it('keeps the newest of the old logs in .1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    const f = new RotatingFile(join(dir, 'server.log'), { maxBytes: 10, keep: 3 });
    for (const word of ['first....\n', 'second...\n', 'third....\n', 'fourth...\n']) f.write(word);
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toBe('fourth...\n');
    expect(readFileSync(join(dir, 'server.log.1'), 'utf8')).toBe('third....\n');
    expect(readFileSync(join(dir, 'server.log.3'), 'utf8')).toBe('first....\n');
  });

  it('carries on where an earlier run left the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    new RotatingFile(join(dir, 'server.log'), { maxBytes: 100 }).write(`${'a'.repeat(90)}\n`);
    new RotatingFile(join(dir, 'server.log'), { maxBytes: 100 }).write(`${'b'.repeat(30)}\n`);
    expect(readFileSync(join(dir, 'server.log.1'), 'utf8')).toMatch(/^a+\n$/);
  });

  it('writes a line longer than the limit rather than losing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    const f = new RotatingFile(join(dir, 'server.log'), { maxBytes: 10 });
    f.write(`${'z'.repeat(40)}\n`);
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toBe(`${'z'.repeat(40)}\n`);
  });

  it('makes the folder it writes into', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    new RotatingFile(join(dir, 'logs', 'server.log')).write('hi\n');
    expect(readFileSync(join(dir, 'logs', 'server.log'), 'utf8')).toBe('hi\n');
  });
});

describe('createLogger', () => {
  it('writes JSON lines with the password and cookies blanked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-log-'));
    const log = createLogger({ file: join(dir, 'server.log') });
    log.info(
      { req: { headers: { cookie: 'ts=secret' }, body: { password: 'hunter2hunter2' } }, res: { headers: { 'set-cookie': 'ts=fresh' } } },
      'hello',
    );
    await new Promise((r) => setTimeout(r, 50));
    const line = JSON.parse(readFileSync(join(dir, 'server.log'), 'utf8').trim().split('\n').pop()!);
    expect(line.msg).toBe('hello');
    expect(line.req.headers.cookie).toBe('[redacted]');
    expect(JSON.stringify(line)).not.toMatch(/secret|hunter2|fresh/);
  });
});
