import { createAnswers } from '@workoffdesk/client/chat/answered';
import { createChatFeeds } from '@workoffdesk/client/chat/chatFeed';
import { createDrafts } from '@workoffdesk/client/composer/drafts';
import { createJournals } from '@workoffdesk/client/journal/journal';
import { createKeyBar } from '@workoffdesk/client/composer/keyBar';
import { MESSAGE_ID_BYTES, messageId } from '@workoffdesk/client/base/messages';
import { standardSocket, type OpenSocket, type Visibility } from '@workoffdesk/client/base/platform';
import { createSeen } from '@workoffdesk/client/sessions/seen';
import { createSessions } from '@workoffdesk/client/sessions/session';
import { createSnippets } from '@workoffdesk/client/composer/snippets';
import { createSessionLinks } from '@workoffdesk/client/sessions/sessionLink';
import { createSessionList } from '@workoffdesk/client/sessions/sessionList';
import { createTextSize } from '@workoffdesk/client/settings/textSize';
import { api, wsUrl } from './api';
import { keepChat, keptChat } from './chatStore';
import { navigate } from './router';
import { storage } from './storage';

// What the shared client needs from a browser: its storage, whether the page is in front, its sockets
// (signed in by the cookie), and the way to the login page.

export { storage };
export const visibility: Visibility = {
  visible: () => document.visibilityState === 'visible',
  onChange: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

const open: OpenSocket = (path, on) => standardSocket(new WebSocket(wsUrl(path)), on);

const toLogin = () => navigate(`/login?next=${encodeURIComponent(location.pathname)}`, true);

export const sessionList = createSessionList({ open, storage, visibility, onSignedOut: toLogin, ask: () => api('/api/events/now') });
export const sessionLinks = createSessionLinks({ open, visibility, onSignedOut: toLogin });
export const chatFeeds = createChatFeeds({ api, visibility, store: { kept: keptChat, keep: (id, c) => void keepChat(id, c) } });
// The page's copy of each session's journal, kept as long as the page is open.
export const journals = createJournals({ api, visibility, newId: () => messageId(crypto.getRandomValues(new Uint8Array(MESSAGE_ID_BYTES))) });
export const answers = createAnswers(storage, journals);
export const seen = createSeen(storage);
export const drafts = createDrafts(storage);
export const textSize = createTextSize(storage);
export const snippets = createSnippets(storage);
export const sessions = createSessions({
  api,
  journals,
  links: sessionLinks,
  list: sessionList,
  seen,
  answers,
  readClipboard: () => navigator.clipboard.readText(),
});
export const keyBar = createKeyBar(storage);
