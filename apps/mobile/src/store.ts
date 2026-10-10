import { sessionHooks } from '@workoffdesk/react/store';
import { sessions } from './client';

export { useStore } from '@workoffdesk/react/store';
export const { useSession } = sessionHooks(sessions);
