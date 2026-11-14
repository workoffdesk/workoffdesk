export type ListStack = {
  here(): string;
  canDismiss(): boolean;
  dismissAll(): void;
  push(href: { pathname: '/session/[id]'; params: { id: string } }): void;
};

// A session opened from a notification, or from the list beside the page when the screen is wide, is shown over
// the list, so Back goes to the list and not to whatever was open; the one already in front stays as it is.
export function openSessionOverList(stack: ListStack, id: string): void {
  if (stack.here() === `/session/${id}`) return;
  if (stack.canDismiss()) stack.dismissAll();
  stack.push({ pathname: '/session/[id]', params: { id } });
}
