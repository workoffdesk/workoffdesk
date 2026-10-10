import { ApiError, errorText, MACHINE, type Api } from '@workoffdesk/client/base/api';
import type { Answers } from '@workoffdesk/client/chat/answered';
import type { Answer, Ask, Choices } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { useState } from 'react';

export type CardProps = {
  sessionId: string;
  choices: Choices;
  onKey: (data: string) => boolean;
  onScreen: () => void;
  onDone: () => void;
};

// The hooks a card answers with, bound to an app's api and the answers it keeps.
export function answerHooks({ api, answers }: { api: Api; answers: Pick<Answers, 'give'> }) {
  // Posts an answer to the choice on screen, and says what went wrong in words for the card. What was
  // picked (`said`) is kept for the chat to show once the card has gone; null for the field of an answer of
  // one's own, as taking it is not yet an answer.
  function useAnswer(sessionId: string, onDone: () => void, question: string) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const send = async (json: object, said: string | null) => {
      setBusy(true);
      setNote(null);
      try {
        const post = () => api(`/api/m/${MACHINE}/sessions/${sessionId}/choices`, { method: 'POST', json });
        await (said === null ? post() : answers.give(sessionId, post, said, question));
      } catch (e) {
        setNote(e instanceof ApiError && e.status === 409 ? t.optionsChanged : errorText(e, t.notPressed, t.notPressed));
      }
      setBusy(false);
      onDone();
    };
    return { busy, note, send };
  }

  // A permission prompt Claude Code said it holds: answered by what it means, not by keys, so an answer
  // meant for it reaches it or nothing.
  function useAskAnswer(sessionId: string, ask: Ask, question: string, onDone: () => void) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const send = async (answer: Answer, said: string, code?: string) => {
      setBusy(true);
      setNote(null);
      try {
        await answers.give(sessionId, () => api(`/api/m/${MACHINE}/sessions/${sessionId}/asks/${ask.id}`, { method: 'POST', json: answer }), said, question, code);
      } catch (e) {
        setNote(e instanceof ApiError && e.status === 409 ? t.askOver : errorText(e, t.notPressed, t.notPressed));
      }
      setBusy(false);
      onDone();
    };
    return { busy, note, send };
  }

  // A question that takes several answers: ticks stay in the card until it is sent, all at once.
  function useTicks(props: CardProps) {
    const { busy, note, send } = useAnswer(props.sessionId, props.onDone, props.choices.context);
    const { options } = props.choices;
    const [ticked, setTicked] = useState(() => new Set(options.flatMap((o, i) => (o.ticked ? [i] : []))));
    const flip = (i: number) =>
      setTicked((was) => {
        const next = new Set(was);
        if (!next.delete(i)) next.add(i);
        return next;
      });
    const sendTicks = () => {
      const picked = [...ticked].sort((a, b) => a - b);
      send({ ticked: picked, labels: options.map((o) => o.label) }, picked.map((i) => options[i].label).join(t.listSeparator) || t.noneTicked);
    };
    return { busy, note, ticked, flip, sendTicks };
  }

  return { useAnswer, useAskAnswer, useTicks };
}
