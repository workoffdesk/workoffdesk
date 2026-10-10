import { sessionHooks } from '@workoffdesk/react/store';
import { sessions, visibility } from './platform';

export { useStore } from '@workoffdesk/react/store';
// One page shows at a time: the page in front is the one shown while the browser tab is.
export const { useSession } = sessionHooks(sessions, () => visibility);
