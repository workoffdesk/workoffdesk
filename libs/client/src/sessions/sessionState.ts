import { t } from '@workoffdesk/i18n';
import { agentName, isAgent, type ClaudeStatus, type TermSession } from '../base/api';
import { callGoing, hasDialog, type ModelChoice, type OnScreen } from '../model/chat';
import { queue, type InQueue, type SessionView } from '../journal/journalRows';
import { headerStatus, type LinkState } from './sessionLink';

// What one open session screen keeps for itself, beside what the journal and the list say.
export type SessionLocal = {
  ctrl: boolean;
  toast: string | null;
  switching: boolean;
  // The command at work being sent to the background, until the Mac answers.
  backgrounding: boolean;
  // A command from the pill, until the dialog it opens shows.
  commanding: string | null;
  // A dialog a pick was made in, held until the screen after the pick is read.
  settling: OnScreen | null;
  // Text handed back to the composer; each new n puts it in.
  refill: { text: string; n: number } | null;
  // Bumped each time a message is held back by an open panel.
  nudge: number;
  models: ModelChoice[] | null;
  ending: boolean;
  // The suggestion turned down, until Claude offers another.
  dismissed: string | null;
  // Messages being taken back: out of the tray until the Mac answers.
  taking: ReadonlySet<string>;
  // The mode last read while nothing covered the prompt.
  lastMode: string | null | undefined;
};

export const startLocal = (): SessionLocal => ({
  ctrl: false,
  toast: null,
  switching: false,
  backgrounding: false,
  commanding: null,
  settling: null,
  refill: null,
  nudge: 0,
  models: null,
  ending: false,
  dismissed: null,
  taking: new Set(),
  lastMode: undefined,
});

// endedBefore: the list never had it while this screen was open, and this device saw it end before.
export type SessionFacts = { view: SessionView; known: TermSession | undefined; endedBefore: boolean; link: LinkState };

export type SessionShown = {
  // The journal's view, with what it says Claude is doing now put aside while the list knows better.
  view: SessionView;
  kind: TermSession['kind'] | null;
  ended: boolean;
  // Its agent quit, while the session is still on the Mac: its conversation goes on in it, or another starts.
  quit: boolean;
  status: ClaudeStatus | null | undefined;
  header: ReturnType<typeof headerStatus> | undefined;
  covered: boolean;
  mode: string | null | undefined;
  queued: InQueue[];
  queueWhy: string;
  canSendNow: boolean;
  canBackground: boolean;
  // What runs in the foreground, while it can be sent to the background, when the conversation says.
  foreground: string | null;
  suggestion: string | null;
  dialog: OnScreen | null;
  dialogBusy: boolean;
};

export function queueWhy(status: ClaudeStatus | null | undefined, who: string): string {
  if (status === 'starting') return t.queueWhenStarted(who);
  if (status === 'ended') return t.queueWhenContinued(who);
  if (status === 'compacting') return t.queueAfterCompact;
  if (status === 'waiting') return t.queueAfterWaiting(who);
  if (status === 'working') return t.queueAfterTurn(who);
  return t.queueNow;
}

export function sessionState(f: SessionFacts, l: SessionLocal): SessionShown {
  const { known, link } = f;
  // A copy the Mac has moved past that the list contradicts is old news of what Claude is doing.
  const outdated = f.view.behind && !!known?.status && known.status !== f.view.status;
  const view = outdated ? { ...f.view, status: known.status, workingSince: null, live: null } : f.view;
  const { screen } = view;
  const ended = link === 'ended' || view.gone || f.endedBefore || !!known?.past;
  // An ended session waits for nothing; until the journal has said, the list speaks for it.
  const status = ended ? 'ended' : (view.status ?? known?.status);
  const covered = !!(screen.choices || screen.panel) || status === 'waiting';
  const up = hasDialog(screen);
  const canBackground = status === 'working' && !covered && !!screen.background;
  return {
    view,
    kind: known?.kind ?? null,
    ended,
    quit: !ended && isAgent(known?.kind) && status === 'ended',
    status,
    // A chat keeps coming by asking the Mac while its line is down (journal.ts): it is down when the asking fails.
    header: known && headerStatus(known, isAgent(known.kind) ? view.failed : link === 'reconnecting', ended),
    covered,
    mode: covered ? l.lastMode : screen.mode,
    queued: queue(view, l.taking),
    queueWhy: queueWhy(status, agentName(known?.kind)),
    canSendNow: status === 'working' && !covered,
    canBackground,
    foreground: canBackground ? (callGoing(view.items)?.summary ?? null) : null,
    suggestion: isAgent(known?.kind) && status === 'idle' && screen.suggestion && screen.suggestion !== l.dismissed ? screen.suggestion : null,
    dialog: up ? screen : l.settling,
    dialogBusy: !up && !!l.settling,
  };
}
