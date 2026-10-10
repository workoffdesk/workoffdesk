import { moveOptionLine, type AccountMove, type AccountMoveSnapshot } from '@workoffdesk/client/sessions/moveAccount';
import { t } from '@workoffdesk/i18n';
import { Sheet } from './Sheet';

type Props = { move: AccountMove; state: AccountMoveSnapshot };

// Under a reply an account's limit stopped: going on on another account of the Mac's, the move under way, or,
// with none, how to add one.
export function LimitActions({ move, state }: Props) {
  if (state.waiting)
    return (
      <small className="chat-limit-how" role="status">
        <span className="spinner small" aria-hidden /> {t.movingAccount(state.waiting.email)}
      </small>
    );
  if (!state.accounts) return null;
  if (!state.accounts.length) return <small className="chat-limit-how">{t.moveAccountHow}</small>;
  return (
    <button className="btn small primary" onClick={() => move.offer(t.continueWord, false)}>
      {t.moveAccount}
    </button>
  );
}

// The accounts to go on on, asked from the limit's note or by a message typed while stopped on it, which goes
// once moved. onGiveBack: the typed message, when not moved.
export function MoveAccountSheet({ move, state, onGiveBack }: Props & { onGiveBack: (text: string) => void }) {
  const { asking, accounts, moving, error } = state;
  if (!asking || !accounts) return null;
  const close = () => {
    const typed = move.dismiss();
    if (typed) onGiveBack(typed);
  };
  return (
    <Sheet title={t.moveAccountTitle} onClose={close}>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {asking.typed && <p className="sheet-lead">{t.moveAccountThen(asking.text)}</p>}
      {accounts.map((a) => (
        <button key={a.id} className="option" disabled={moving !== null} aria-busy={moving === a.id} onClick={() => void move.move(a.id)}>
          <span className="opt-text">
            <span className="opt-title">{a.email}</span>
            <span className="opt-sub">{moveOptionLine(a)}</span>
          </span>
          {moving === a.id && <span className="spinner small" aria-hidden />}
        </button>
      ))}
      <p className="sheet-note">{t.moveAccountNote}</p>
    </Sheet>
  );
}
