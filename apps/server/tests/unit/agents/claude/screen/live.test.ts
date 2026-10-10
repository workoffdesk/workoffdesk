import { describe, expect, it } from 'vitest';
import { liveText } from '../../../../../src/agents/claude/screen/live.js';

// The bottom of a Claude Code screen as captured (capture-pane -J), above the prompt.
const PROMPT = ['', '✢ Fiddle-faddling… (7m 36s · ↓ 29.9k tokens)', '', '─'.repeat(40), '❯ ', '─'.repeat(40)];
const screen = (...lines: string[]) => [...lines, ...PROMPT].join('\n');

const REPLY = ['⏺ The finished form has no marker. I need the in-progress form, so', "  I'll record my own pane:"];
const BASH = ['⏺ Bash(ls /tmp)', '  ⎿  Running in the background (↓ to manage)'];

describe('liveText', () => {
  it('returns the reply it is writing', () => {
    expect(liveText(screen(...BASH, '', ...REPLY), 70)).toBe("The finished form has no marker. I need the in-progress form, so I'll record my own pane:");
  });

  it('returns nothing while a call is at work', () => {
    expect(liveText(screen(...REPLY, '', ...BASH), 100)).toBeNull();
  });

  // Reads and searches are drawn as one line; while they run its ⏺ blinks, so it is there or not.
  it.each([
    ['being read, marker shown', '⏺ Reading 1 file… (ctrl+o to expand)'],
    ['being read, marker blinked off', '  Reading 1 file… (ctrl+o to expand)'],
    ['being searched', '⏺ Searching for 2 patterns… (ctrl+o to expand)'],
    ['read and searched, done', '  Searched for 1 pattern, listed 1 directory (ctrl+o to expand)'],
  ])('returns nothing after files %s, whatever was written before', (_, line) => {
    expect(liveText(screen(...REPLY, '', line), 100)).toBeNull();
  });

  it('returns the reply written after files were read', () => {
    expect(liveText(screen('  Read 1 file (ctrl+o to expand)', '', '⏺ Found it.'), 100)).toBe('Found it.');
  });
});
