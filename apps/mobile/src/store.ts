import { sessionHooks, useInFront } from '@workoffdesk/react/store';
import { useIsFocused } from 'expo-router';
import { sessions, visibility } from './client';

export { useStore } from '@workoffdesk/react/store';
// Whether this screen is in front: the app is, and no screen is pushed over this one.
export const usePage = () => useInFront(visibility, useIsFocused());
export const { useSession } = sessionHooks(sessions, usePage);
