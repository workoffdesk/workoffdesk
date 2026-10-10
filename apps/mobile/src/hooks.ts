import type { TermSession } from '@workoffdesk/client/base/api';
import type { ChatState } from '@workoffdesk/client/model/chat';
import type { ChatFeed } from '@workoffdesk/client/chat/chatFeed';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { auth, chatFeeds, sessionList } from './client';
import { usePage } from './store';

export const useLogin = () => useSyncExternalStore(auth.subscribe, auth.current);
export const useAccounts = () => useSyncExternalStore(auth.subscribe, auth.accounts);

// The session list, live from /api/events while any screen shows it.
export const useSessions = (): TermSession[] | null => useSyncExternalStore(sessionList.subscribe, sessionList.current);

// A chat as the shared feed reads it (chatFeed.ts): as last shown in this run of the app, then from the Mac.
export function useChat(sessionId: string, url: string) {
  const [chat, setChat] = useState<ChatState | null>(() => chatFeeds.remembered(sessionId));
  const [failed, setFailed] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const feed = useRef<ChatFeed | null>(null);
  const page = usePage();
  useEffect(() => {
    const f = chatFeeds.follow(sessionId, url, { show: setChat, failed: setFailed, loadingOlder: setLoadingOlder }, page);
    feed.current = f;
    return () => {
      f.stop();
      feed.current = null;
    };
  }, [sessionId, url, page]);
  const loadOlder = useCallback(async () => feed.current?.older(() => {}), []);
  return { chat, failed, loadingOlder, loadOlder };
}
