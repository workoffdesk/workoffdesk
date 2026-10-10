import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { typedOn } from '../../../../../src/agents/claude/screen/prompt.js';

// What is typed at Claude's prompt, so nothing is typed after it: from the screen, and its styled copy, which
// tells Claude's dimmed suggestion from text typed there.
const screenOf = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const IDLE = screenOf('idle-input');
const withPrompt = (rest: string) => IDLE.replace('❯\u00a0\n', `❯\u00a0${rest}\n`);

describe('typedOn', () => {
  it('finds the prompt empty', () => {
    expect(IDLE).toContain('❯\u00a0\n');
    expect(typedOn(IDLE, '\x1b[39m❯\u00a0\n')).toBeNull();
  });

  it('finds text typed there', () => {
    expect(typedOn(withPrompt('half a thought'), '\x1b[39m❯\u00a0half a thought\n')).toBe('half a thought');
  });

  it.each([
    ['what Claude suggests saying next', 'commit this'],
    ['the example on a fresh prompt', 'Try "fix lint errors"'],
  ])('does not take %s, dimmed, for text typed', (_, dimmed) => {
    expect(typedOn(withPrompt(dimmed), `\x1b[39m❯\u00a0\x1b[2m${dimmed}\x1b[0m\n`)).toBeNull();
  });

  // Not knowing which, it is taken as typed: what is typed then waits rather than going after someone's words.
  it('takes text there as typed when the styled screen says nothing of it', () => {
    expect(typedOn(withPrompt('half a thought'), '')).toBe('half a thought');
  });

  it('finds no prompt on a screen without one', () => {
    expect(typedOn(screenOf('ask-user-question'), '')).toBeNull();
  });
});
