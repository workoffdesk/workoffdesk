import { router } from 'expo-router';
import type { ListStack } from './openSession';

// The app's own stack, for openSessionOverList; here: the path of the page in front.
export const routerStack = (here: () => string): ListStack => ({
  here,
  canDismiss: () => router.canDismiss(),
  dismissAll: () => router.dismissAll(),
  push: (href) => router.push(href),
});
