import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isCompacting } from '../../../../../src/agents/claude/screen/compacting.js';

const screen = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const RULE = '─'.repeat(60);
const prompt = (above: string[]) => [...above, RULE, '❯ ', RULE, '  Alice  Opus 5.5', ''].join('\n');

// compacting is a real /compact on Claude Code 2.1.289 (2026-10-04): the spinner with a tip under it, and an
// earlier "Baked for" spinner further up.
describe('isCompacting', () => {
  it('sees the compaction spinner just above the prompt', () => {
    expect(isCompacting(screen('compacting'))).toBe(true);
  });

  it('sees the spinner with a tip under it', () => {
    expect(isCompacting(prompt(['⏺ done.', '', '✶ Compacting conversation… (8s · esc to interrupt)', '  ⎿  Tip: Use /memory to edit your Claude memory', '']))).toBe(true);
  });

  it('sees the hooks that run around a compaction as part of it', () => {
    expect(isCompacting(prompt(['⏺ done.', '', '✢ Running PreCompact hooks… (1s)', '']))).toBe(true);
    expect(isCompacting(prompt(['⏺ done.', '', '✢ Running PostCompact hooks… (1s)', '']))).toBe(true);
  });

  it.each(['idle-after-answer', 'idle-input', 'ask-user-question', 'model-picker', 'settings-usage'])('does not see one on %s', (name) => {
    expect(isCompacting(screen(name))).toBe(false);
  });

  it('does not see one once the compaction is over', () => {
    expect(isCompacting(prompt(['✻ Conversation compacted (ctrl+o for history)', '']))).toBe(false);
    expect(isCompacting(prompt(['  ⎿  Compaction canceled.', '']))).toBe(false);
  });

  it('does not see one in the words of the conversation itself', () => {
    expect(isCompacting(prompt(['⏺ The spinner says', '  ✶ Compacting conversation… while it runs.', '', '✻ Baked for 5s', '']))).toBe(false);
    expect(isCompacting(prompt(['⏺ Compacting conversation… is what the spinner says.', '']))).toBe(false);
  });

  it('does not see one without a prompt under it', () => {
    expect(isCompacting('✶ Compacting conversation… (8s · esc to interrupt)\n')).toBe(false);
  });
});
