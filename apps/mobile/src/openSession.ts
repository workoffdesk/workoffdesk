export type OutsideStack = {
  here(): string;
  canDismiss(): boolean;
  dismissAll(): void;
  push(href: { pathname: '/session/[id]'; params: { id: string } }): void;
};

// A session opened from outside the app (a notification) is shown over the list, as if opened from it, so Back
// goes to the list and not to whatever was open; the one already in front stays as it is.
export function openSessionFromOutside(stack: OutsideStack, id: string): void {
  if (stack.here() === `/session/${id}`) return;
  if (stack.canDismiss()) stack.dismissAll();
  stack.push({ pathname: '/session/[id]', params: { id } });
}
