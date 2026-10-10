import { sessionHooks } from '@workoffdesk/react/store';
import { sessions } from './platform';

export { useStore } from '@workoffdesk/react/store';
export const { useSession } = sessionHooks(sessions);
