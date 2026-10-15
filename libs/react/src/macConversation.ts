import { errorText, type Agent, type Api, type RecentConversation } from '@workoffdesk/client/base/api';
import { cancelTakeOver, createSession, macConversation, pickUpOf, takeOver } from '@workoffdesk/client/sessions/newSession';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState } from 'react';

// How often the Mac is looked at again while the conversation is open there (what the buttons offer follows it),
// or while it cannot be reached.
const MAC_LOOK_MS = 3_000;

// A Claude or Codex conversation from this Mac, read before picking it up here: what the Mac says of it, and
// picking it up, after which the page goes to the session it became (`go`). info is undefined until the Mac
// answers, null when it has no such conversation. Until then it is what the list had (`kept`), if anything, so the
// page is drawn whole at once; `fresh` says the Mac has answered, which what is done on it waits for.
export function useMacConversation(api: Api, agent: Agent, sid: string, go: (id: string) => void, kept?: RecentConversation) {
  const [answered, setInfo] = useState<RecentConversation | null | undefined>(undefined);
  const fresh = answered !== undefined;
  const info = fresh ? answered : kept;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last time the Mac was asked, it could not be reached; it is asked again until it answers.
  const [unreachable, setUnreachable] = useState(false);
  // Asked again after each press, and every few seconds while the conversation is open on the Mac.
  const [asked, setAsked] = useState(0);
  // This page follows a take-over waiting on the Mac: to the session once it is open, or to say it was not.
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    let gone = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    macConversation(api, agent, sid).then(
      (r) => {
        if (gone) return;
        setUnreachable(false);
        setInfo(r);
        if (r?.takingOver) setFollowing(true);
      },
      () => {
        if (gone) return;
        setUnreachable(true);
        again = setTimeout(() => setAsked((n) => n + 1), MAC_LOOK_MS);
      },
    );
    return () => {
      gone = true;
      clearTimeout(again);
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
    if (!fresh || !info?.cwd) return;
    setBusy(true);
    setError(null);
    setFollowing(false);
    try {
      const made = await work(info.cwd);
      if (made) return go(made.id);
    } catch (e) {
      setError(errorText(e, t.openFailed));
    }
    // What the Mac said of it may be what the press was refused for (opened in a terminal since): it is asked again.
    setAsked((n) => n + 1);
    setBusy(false);
  };
  return {
    info,
    fresh,
    busy,
    error,
    unreachable,
    pick,
    waiting,
    missed,
    resume: () => run((cwd) => createSession(api, { kind: agent, cwd, resumeId: sid })),
    takeOverNow: () => run((cwd) => takeOver(api, { ...info!, cwd }, 'now')),
    takeOverWhenDone: () => run((cwd) => takeOver(api, { ...info!, cwd }, 'whenIdle')),
    cancel: () => run(() => cancelTakeOver(api, info!).then(() => null)),
  };
}
