import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestionOn, typedOn } from '../../../../../src/agents/claude/screen/prompt.js';

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

  // Dim lasts until it is turned off (0, 22, or a bare reset), whatever else changes on the way.
  it.each([
    ['dimmed with its colour changed after', '\x1b[2m\x1b[39mcommit this\x1b[0m'],
    ['dimmed along with a colour', '\x1b[2;39mcommit this\x1b[0m'],
    ['dimmed in two runs of colour', '\x1b[2m\x1b[38;5;241mcommit \x1b[39mthis\x1b[m'],
    ['dimmed to the end of the line', '\x1b[2mcommit this'],
  ])('does not take a suggestion %s for text typed', (_, styled) => {
    expect(typedOn(withPrompt('commit this'), `\x1b[39m❯\u00a0${styled}\n`)).toBeNull();
  });

  it.each([
    ['dim turned off', '\x1b[2mfix\x1b[22m it'],
    ['a full reset', '\x1b[2mfix\x1b[0m it'],
    ['a bare reset', '\x1b[2mfix\x1b[m it'],
    ['a reset that turns something else on', '\x1b[2mfix\x1b[0;1m it'],
  ])('finds text typed after %s', (_, styled) => {
    expect(typedOn(withPrompt('fix it'), `\x1b[39m❯\u00a0${styled}\n`)).toBe('fix it');
  });

  // Claude Code 2.1.296, a message in its queue while it works: the prompt shows how to edit it, dimmed.
  it('does not take the hint shown while a message waits in Claude\'s queue for text typed', () => {
    const screen = screenOf('queued-message');
    expect(screen).toContain('❯\u00a0Press up to edit queued messages\n');
    const styled = '\x1b[38;5;241m\x1b[48;5;255m❯\u00a0fourth message queued here\x1b[39m\n\x1b[38;5;241m❯\u00a0\x1b[2m\x1b[39mPress up to edit queued messages\x1b[0m\n';
    expect(typedOn(screen, styled)).toBeNull();
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

describe('suggestionOn', () => {
  it("does not take the hint shown while a message waits in Claude's queue for something to say", () => {
    expect(suggestionOn('\x1b[38;5;241m❯\u00a0\x1b[2m\x1b[39mPress up to edit queued messages\x1b[0m\n')).toBeNull();
  });
});
