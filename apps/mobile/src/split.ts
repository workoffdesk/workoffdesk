// The page beside the list is never narrower than the narrowest iPhone's screen.
export const CHAT_MIN = 360;
// The list's width in the web app's split (apps/web/src/styles.css), and the least a row reads at.
const LIST = 320;
const LIST_MIN = 280;

// How wide the session list is when it stays on the left of whatever is open, or null for one page at a time.
// Only the window's size decides, never the kind of phone. An iPhone upright is too narrow, and one on its side
// too short to show a chat and its keyboard beside a list; a screen that opens out to a tablet's size, either
// way up, lists its sessions beside the page.
export function splitOf(width: number, height: number): { list: number } | null {
  if (width < splitOf.from.width || height < splitOf.from.height) return null;
  return { list: width - LIST >= CHAT_MIN ? LIST : LIST_MIN };
}
splitOf.from = { width: LIST_MIN + CHAT_MIN, height: 500 };

// How a page opens. Beside the list it takes the place of the one open, as a list's selection changes what is
// shown; one page at a time, it slides in over the last, for Back to slide it away.
export const openingOf = (split: { list: number } | null): 'none' | 'default' => (split ? 'none' : 'default');
