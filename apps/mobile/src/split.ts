// The page beside the list is never narrower than the narrowest iPhone's screen.
export const CHAT_MIN = 360;
// The list's width in the web app's split (apps/web/src/styles.css), and the least a row reads at.
const LIST = 320;
const LIST_MIN = 280;

// How wide the session list is when it stays on the left of whatever is open, or null for one page at a time.
// Only the window's width decides, never the kind of phone: an iPhone held upright stays one page at a time,
// and a screen that opens out to a tablet's width lists its sessions beside the page.
export function splitOf(width: number): { list: number } | null {
  if (width < splitOf.from) return null;
  return { list: width - LIST >= CHAT_MIN ? LIST : LIST_MIN };
}
splitOf.from = LIST_MIN + CHAT_MIN;
