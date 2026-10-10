import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModels } from '../../../../../src/agents/claude/offers/models.js';

// The models /model takes, as Claude Code answers initialize for this account. A shell script stands in for it.
const claude = (models: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-claude-'));
  const bin = join(dir, 'claude');
  const line = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response: { models } } });
  writeFileSync(bin, `#!/bin/sh\nhead -n 1 > /dev/null\nprintf '%s\\n' '${line.replaceAll("'", "'\\''")}'\nexec sleep 30\n`);
  chmodSync(bin, 0o755);
  return { bin, cwd: mkdtempSync(join(tmpdir(), 'ts-project-')) };
};
const models = (list: unknown) => {
  const c = claude(list);
  return listModels(c.bin, c.cwd);
};

describe('listModels', () => {
  it("gives Claude Code's models, in its order, with the efforts each takes", async () => {
    expect(
      await models([
        { value: 'default', displayName: 'Default (recommended)', description: 'Opus for this plan', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 7, null] },
        { value: 'opus[1m]', displayName: 'Opus 1M', description: 'For long sessions' },
        { value: 'haiku', supportsEffort: false, supportedEffortLevels: ['low'] },
      ]),
    ).toEqual([
      { value: 'default', name: 'Default (recommended)', about: 'Opus for this plan', efforts: ['low', 'medium', 'high'] },
      { value: 'opus[1m]', name: 'Opus 1M', about: 'For long sessions', efforts: [] },
      { value: 'haiku', name: 'haiku', about: '', efforts: [] },
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['say so in other words than true', { supportsEffort: 'true', supportedEffortLevels: ['low'] }],
    ['give no list of levels', { supportsEffort: true, supportedEffortLevels: 'low,high' }],
  ])('gives no effort to models that %s', async (_, effort) => {
    expect((await models([{ value: 'sonnet', ...effort }]))[0].efforts).toEqual([]);
  });

  it('names a model by its value when the name given is empty or not text', async () => {
    expect((await models([{ value: 'sonnet', displayName: '' }, { value: 'opus', displayName: 3, description: { long: true } }])).map((m) => [m.name, m.about])).toEqual([
      ['sonnet', ''],
      ['opus', ''],
    ]);
  });

  it('leaves out what could not be typed at the prompt as a /model value', async () => {
    const kept = ['claude-opus-4-5-20251101', 'opus[1m]', 'us.anthropic:claude.v2', 'x'.repeat(40)];
    const dropped = ['', 'x'.repeat(41), 'opus; rm -rf ~', 'two words', 'opus\n/exit', 7, null];
    const list = [...dropped.map((value) => ({ value })), null, 'sonnet', [], ...kept.map((value) => ({ value })), { displayName: 'no value' }];
    expect((await models(list)).map((m) => m.value)).toEqual(kept);
  });

  it.each<[string, unknown]>([
    ['no list', undefined],
    ['something else than a list', { default: {} }],
  ])('gives none when Claude Code gives %s', async (_, list) => {
    expect(await models(list)).toEqual([]);
  });

  it('gives none when Claude Code cannot be asked', async () => {
    expect(await listModels(join(tmpdir(), 'no-such-claude'), tmpdir())).toEqual([]);
  });
});
