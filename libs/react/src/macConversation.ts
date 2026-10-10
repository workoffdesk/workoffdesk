import { agentOf, errorText, type Agent, type Api, type RecentConversation } from '@workoffdesk/client/base/api';
import { cancelTakeOver, createSession, pickUpOf, recentConversations, takeOver } from '@workoffdesk/client/sessions/newSession';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState } from 'react';

// How often the Mac is looked at again while the conversation is open there: what the buttons offer follows it.
const MAC_LOOK_MS = 3_000;

// A Claude or Codex conversation from this Mac, read before picking it up here: what the Mac says of it, and
// picking it up, after which the page goes to the session it became (`go`).
export function useMacConversation(api: Api, agent: Agent, sid: string, go: (id: string) => void) {
  const [info, setInfo] = useState<RecentConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Asked again after each take-over asked for, and every few seconds while the conversation is open on the Mac.
  const [asked, setAsked] = useState(0);
  // This page follows a take-over waiting on the Mac: to the session once it is open, or to say it was not.
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    let gone = false;
    recentConversations(api).then(
      (all) => {
        if (gone) return;
        const r = all.find((x) => x.sessionId === sid && agentOf(x) === agent) ?? null;
        setInfo(r);
        if (r?.takingOver) setFollowing(true);
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [api, agent, sid, asked]);
  const pick = info ? pickUpOf(info) : null;
  const waiting = pick?.do === 'takeOver' && pick.waiting;
  const onMac = pick?.do === 'takeOver';
  useEffect(() => {
    if (!onMac) return;
    const timer = setInterval(() => setAsked((n) => n + 1), MAC_LOOK_MS);
    return () => clearInterval(timer);
  }, [onMac]);
  // A take-over waited on goes to the session once it is open here; one that ended with none did not happen.
  useEffect(() => {
    if (pick?.do === 'open' && following) go(pick.id);
  });
  const missed = following && !waiting && pick?.do !== 'open';
  const run = async (work: (cwd: string) => Promise<{ id: string } | null>) => {
    if (!info?.cwd) return;
    setBusy(true);
    setError(null);
    setFollowing(false);
    try {
      const made = await work(info.cwd);
      if (made) return go(made.id);
      setAsked((n) => n + 1);
    } catch (e) {
      setError(errorText(e, t.openFailed));
    }
    setBusy(false);
  };
  return {
    info,
    busy,
    error,
    pick,
    waiting,
    missed,
    resume: () => run((cwd) => createSession(api, { kind: agent, cwd, resumeId: sid })),
    takeOverNow: () => run((cwd) => takeOver(api, { ...info!, cwd }, 'now')),
    takeOverWhenDone: () => run((cwd) => takeOver(api, { ...info!, cwd }, 'whenIdle')),
    cancel: () => run(() => cancelTakeOver(api, info!).then(() => null)),
  };
}
