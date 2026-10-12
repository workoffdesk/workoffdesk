// What Claude Code shows at its prompt besides what is typed there.

// After Claude answers it may offer what the user is likely to say next, dimmed at the empty prompt; what
// is typed there is not dimmed.
// eslint-disable-next-line no-control-regex -- the dimming is an escape sequence
const SUGGESTION = new RegExp('❯[\\u00a0 ]\\x1b\\[2m([^\\x1b\\n]+)\\x1b\\[0m\\s*$');

export function suggestionOn(styled: string): string | null {
  const lines = styled.replace(/\n+$/, '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('❯')) continue;
    const m = SUGGESTION.exec(lines[i]);
    const text = m?.[1].trim();
    // The hint on a fresh prompt is an example, not something to send.
    return text && !/^Try "/.test(text) ? text : null;
  }
  return null;
}

// The permission mode, from the line under the prompt: "bypass permissions", "accept edits", "plan mode",
// "auto mode"; null in the default mode, which shows none.
const MODE = /(?:⏵⏵|⏸)\s+([a-z][a-z ]*?) on\b/;

export function modeOn(screen: string): string | null {
  return MODE.exec(screen)?.[1] ?? null;
}

// What is typed at the prompt (❯ at the edge, right under the prompt's rule), or null when nothing is: text
// there that is all dimmed, if word by word, is Claude's suggestion, example, or hint for its queue.
// Dim (2) holds until 22 or a reset turns it off, through any other change of style.
// eslint-disable-next-line no-control-regex -- styles are escape sequences
const STYLE = /\x1b\[([0-9;]*)m/g;
function allDimmed(promptLine: string): boolean {
  const after = promptLine.slice(promptLine.indexOf('❯') + 1);
  let dim = false;
  let plain = '';
  let from = 0;
  for (const m of after.matchAll(STYLE)) {
    if (!dim) plain += after.slice(from, m.index);
    for (const p of m[1].split(';')) {
      if (p === '2') dim = true;
      else if (p === '' || p === '0' || p === '22') dim = false;
    }
    from = m.index + m[0].length;
  }
  if (!dim) plain += after.slice(from);
  return !plain.replace(/\u00a0/g, ' ').trim();
}

export function typedOn(screen: string, styled: string): string | null {
  const lines = screen.replace(/\n+$/, '').split('\n');
  const at = lines.findLastIndex((l, i) => l.startsWith('❯') && i > 0 && /^─{10,}/.test(lines[i - 1]));
  const typed = at < 0 ? '' : lines[at].slice(1).replace(/\u00a0/g, ' ').trim();
  if (!typed) return null;
  const promptLine = styled.split('\n').findLast((l) => l.includes('❯'));
  return promptLine && allDimmed(promptLine) ? null : typed;
}
