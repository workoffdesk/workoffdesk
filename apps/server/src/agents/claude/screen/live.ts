// What Claude is writing now, read off the screen: the transcript gets a reply only once it is whole, while
// the screen shows it line by line. Its text is the last block that starts with ⏺ and goes on in lines
// indented two spaces, above the rule over the prompt and below the last message the user sent, so the reply
// to an earlier message is never taken for this one's. A block that is a tool at work, or reads and searches,
// is not a reply.
const BLOCK_START = /^⏺ /;
const GOES_ON = /^ {2}/;
const TOOL = /^⏺ [\w.:-]+\(/;
// Reads and searches, drawn as one line that opens with ctrl+o; while they run its ⏺ blinks to a space.
const CALLS = /^(?:⏺| ) \S.*\(ctrl\+o to expand\)$/;
const TOOL_RESULT = '⎿';
// A message the user sent, and the prompt they type at, which sits between two rules.
const SENT = /^❯(?:[\u00a0 ]|$)/;
const RULE = /^─{8,}$/;
const INDENT = 2;
// Lines that start a block of their own (list item, heading, quote, fence, table) are never a wrapped tail.
const OWN_LINE = /^(?:[-*+] |\d+[.)] |#|>|```|\|)/;
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

function cells(s: string): number {
  let n = 0;
  for (const ch of s) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

// Claude Code breaks its own lines to fit the terminal, which -J cannot undo. A line was broken by the
// terminal, not by Claude, when the next line's first word would not have fitted after it.
function unwrap(lines: string[], width: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const first = /^\S+/.exec(line)?.[0] ?? '';
    const wide = WIDE.test(first[0] ?? '');
    const head = wide ? first[0] : first;
    const fits = prev !== undefined && cells(prev) + (wide ? 0 : 1) + cells(head) <= width;
    if (prev && line && !OWN_LINE.test(line) && !fits) {
      out[out.length - 1] = prev + (wide || WIDE.test(prev.slice(-1)) ? '' : ' ') + line;
    } else out.push(line);
  }
  return out;
}

// `screen` is a capture with wrapped lines joined (capture-pane -J); `cols` is the width it was drawn at.
export function liveText(screen: string, cols: number): string | null {
  const lines = screen.split('\n').map((l) => l.trimEnd());
  let prompt = lines.length;
  for (let i = lines.length - 1; i > 0 && prompt === lines.length; i--) if (SENT.test(lines[i]) && RULE.test(lines[i - 1])) prompt = i - 1;
  let start = -1;
  for (let i = prompt - 1; i >= 0 && start < 0 && !SENT.test(lines[i]); i--) if (BLOCK_START.test(lines[i]) || CALLS.test(lines[i])) start = i;
  if (start < 0 || TOOL.test(lines[start]) || CALLS.test(lines[start])) return null;
  const block = [lines[start].slice(INDENT)];
  for (let i = start + 1; i < lines.length && (!lines[i] || GOES_ON.test(lines[i])); i++) block.push(lines[i].slice(INDENT));
  if (block.some((l) => l.includes(TOOL_RESULT))) return null;
  const text = unwrap(block, cols - INDENT).join('\n').trim();
  return text || null;
}
