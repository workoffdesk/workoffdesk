import { t } from '@workoffdesk/i18n';
import { errorText, type Api } from '../base/api';
import type { OnScreen } from '../model/chat';

// The most keys the Mac takes in one request (its keys route).
const KEYS_MAX = 200;

// Keys pressed while a session's line is down go as requests, in the order they were pressed; one that fails
// says why and drops those after it, which were pressed for a moment that has passed.
export function keysByRequest(o: { api: Api; base: string; shown: (screen: OnScreen) => void; say: (text: string) => void }) {
  let waiting: string[] = [];
  const next = async (): Promise<void> => {
    const keys = waiting[0];
    if (keys === undefined) return;
    try {
      o.shown((await o.api<{ screen: OnScreen }>(`${o.base}/keys`, { method: 'POST', json: { keys } })).screen);
    } catch (e) {
      waiting = [];
      o.say(errorText(e, t.notPressed, t.notConnectedSend));
      return;
    }
    waiting.shift();
    return next();
  };
  return (keys: string) => {
    const idle = !waiting.length;
    for (let at = 0; at < keys.length; at += KEYS_MAX) waiting.push(keys.slice(at, at + KEYS_MAX));
    if (idle) void next();
  };
}
