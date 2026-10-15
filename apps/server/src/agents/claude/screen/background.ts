// Whether Claude Code offers, under the tool it runs in the foreground, to send it to the background with its
// default key: a line of its own, the key named twice in tmux, whose prefix takes the first press. Another key
// bound to it is one not known here, so it is not offered.
const OFFER = /^\s*\(ctrl\+b(?: ctrl\+b \(twice\))? to run in background\)$/;

export function canBackground(screen: string): boolean {
  return screen.split('\n').some((l) => OFFER.test(l.trimEnd()));
}
