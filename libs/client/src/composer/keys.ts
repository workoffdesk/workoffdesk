// Ctrl+<key> as a terminal sends it: the key's code with the top three bits cleared.
export function ctrlChord(ch: string): string | null {
  if (ch === ' ') return '\x00';
  if (ch === '?') return '\x7f';
  const c = ch.toUpperCase().charCodeAt(0);
  return c >= 0x40 && c <= 0x5f ? String.fromCharCode(c & 0x1f) : null;
}

// Most used first: Esc stops Claude or closes what it opened, the arrows and Enter answer its questions.
export const KEYS = [
  { label: 'Esc', seq: '\x1b' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '⏎', seq: '\r' },
  { label: 'Tab', seq: '\t' },
  { label: '^C', seq: '\x03' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  // Claude Code's "send now" for a message waiting in its own queue.
  { label: '^X^S', seq: '\x18\x13' },
  { label: 'Ctrl', seq: null },
] as const;
export const ENTER = '\r';

// Text not typed key by key goes as one bracketed paste, so the program sees where it ends and takes an
// Enter after it as a keypress: Claude Code reads a block arriving at once as pasted, Enter included. tmux
// drops the brackets for programs that did not ask for them. Ctrl armed makes it a keystroke instead.
export function typedText(text: string, enter: boolean, ctrlArmed: boolean): string {
  const body = !text || ctrlArmed ? text : `\x1b[200~${text.replaceAll('\x1b[201~', '')}\x1b[201~`;
  return body + (enter ? '\r' : '');
}
