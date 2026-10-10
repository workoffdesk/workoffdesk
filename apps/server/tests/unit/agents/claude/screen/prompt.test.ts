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

  // Claude Code 2.1.296 dims the example word by word, the spaces between left plain.
  it.each([
    ['what Claude suggests saying next', 'commit this', '\x1b[2mcommit this\x1b[0m'],
    ['the example on a fresh prompt', 'Try "fix lint errors"', '\x1b[2mTry "fix lint errors"\x1b[0m'],
    ['the example dimmed word by word', 'Try "how does it work?"', '\x1b[2mTry\x1b[0m \x1b[2m"how\x1b[0m \x1b[2mdoes\x1b[0m \x1b[2mit\x1b[0m \x1b[2mwork?"\x1b[0m'],
  ])('does not take %s, dimmed, for text typed', (_, dimmed, styled) => {
    expect(typedOn(withPrompt(dimmed), `\x1b[39m❯\u00a0${styled}\n`)).toBeNull();
  });

  it('finds text typed in front of a dimmed word', () => {
    expect(typedOn(withPrompt('fix it'), '\x1b[39m❯\u00a0fix \x1b[2mit\x1b[0m\n')).toBe('fix it');
  });

  // Not knowing which, it is taken as typed: what is typed then waits rather than going after someone's words.
  it('takes text there as typed when the styled screen says nothing of it', () => {
    expect(typedOn(withPrompt('half a thought'), '')).toBe('half a thought');
  });

  it('finds no prompt on a screen without one', () => {
    expect(typedOn(screenOf('ask-user-question'), '')).toBeNull();
  });
});
