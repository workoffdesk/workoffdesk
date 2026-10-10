// Whether Claude Code is compacting its conversation, read off the screen: its spinner, the line nearest above
// the prompt, says so (a tip may sit under it). The conversation is further up and indented, so words in it
// are not taken for the spinner.
const PROMPT_TOP = /^─{10,}/;
const PROMPT_LINE = /^[❯!]/;
const TIP = /^\s*⎿/;
// Any glyph but the ⏺ that starts each of Claude's replies, then what the spinner says.
const SPINNER = /^[^\s⏺]\s+(Compacting conversation|Running (Pre|Post)Compact hooks)/;

export function isCompacting(screen: string): boolean {
  const lines = screen.split('\n').map((l) => l.trimEnd());
  let top = -1;
  for (let i = lines.length - 2; i >= 0 && top < 0; i--) if (PROMPT_TOP.test(lines[i]) && PROMPT_LINE.test(lines[i + 1])) top = i;
  const above = lines.slice(0, Math.max(top, 0)).filter((l) => l.trim());
  let spinner = above.pop();
  if (spinner !== undefined && TIP.test(spinner)) spinner = above.pop();
  return spinner !== undefined && SPINNER.test(spinner);
}
