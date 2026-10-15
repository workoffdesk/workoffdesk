import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canBackground } from '../../../../../src/agents/claude/screen/background.js';

const screen = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const FOREGROUND = screen('foreground-command');
const TMUX_OFFER = '     (ctrl+b ctrl+b (twice) to run in background)';

// foreground-command follows a real screen of Claude Code 2.1.300 in tmux (2026-10-15): a Bash loop waits in
// the foreground with two messages queued under it.
describe('canBackground', () => {
  it('sees the offer Claude Code draws under a command running in the foreground', () => {
    expect(FOREGROUND).toContain(TMUX_OFFER);
    expect(canBackground(FOREGROUND)).toBe(true);
  });

  it('sees the offer as drawn outside tmux too', () => {
    expect(canBackground(FOREGROUND.replace(TMUX_OFFER, '     (ctrl+b to run in background)'))).toBe(true);
  });

  it('does not see it once the command is over', () => {
    expect(canBackground(FOREGROUND.replace(`${TMUX_OFFER}\n`, ''))).toBe(false);
  });

  it('does not take the words quoted in a line of other text for it', () => {
    const quoted = FOREGROUND.replace(TMUX_OFFER, '  Press it (ctrl+b ctrl+b (twice) to run in background) to free the prompt.');
    expect(canBackground(quoted)).toBe(false);
  });

  it('does not offer a key it does not know: the binding changed to another', () => {
    expect(canBackground(FOREGROUND.replace(TMUX_OFFER, '     (ctrl+g to run in background)'))).toBe(false);
  });

  it.each(['idle-after-answer', 'queued-message', 'ask-user-question', 'compacting'])('does not see it on %s', (name) => {
    expect(canBackground(screen(name))).toBe(false);
  });
});
