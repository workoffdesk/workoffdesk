import { useState } from 'react';
import { clock } from '@workoffdesk/client/model/format';
import { splitMine } from '@workoffdesk/client/chat/images';
import { t } from '@workoffdesk/i18n';
import { COPIED_MS } from './Reply';
import { Files, type Opener, Pictures } from './media';

// Past this a message is shown cut short, to be opened: a long paste would push the reply off the screen.
const FOLD_LINES = 12;

const FOLD_CHARS = 600;

// What was sent from the phone: its pictures as pictures, not as the paths and markers Claude was given,
// and when it was sent. onRewind: offered under the last message sent, to open Claude Code's own list of
// points to go back to.
export function Mine(props: { sessionId: string; text: string; at?: string; onOpen: Opener; onRewind?: () => void }) {
  const { images, files, text: words, unseen } = splitMine(props.text);
  const time = clock(props.at);
  return (
    <>
      <Pictures sessionId={props.sessionId} side="mine" paths={images} onOpen={props.onOpen} />
      <Files files={files} />
      {words && <MineBubble text={words} />}
      {unseen > 0 && <div className="chat-image-note mine">{t.unseenImages(unseen)}</div>}
      {(props.onRewind || time) && (
        <div className="reply-actions mine">
          {props.onRewind && <MineActions text={words} onRewind={props.onRewind} />}
          {time && <span className="mine-time">{time}</span>}
        </div>
      )}
    </>
  );
}

// A message on its way or just sent, before the transcript has it: its pictures as pictures, as in Mine.
export function SentBubble(props: { sessionId: string; text: string; onOpen: Opener }) {
  const { images, files, text: words } = splitMine(props.text);
  return (
    <>
      <Pictures sessionId={props.sessionId} side="mine" paths={images} onOpen={props.onOpen} />
      <Files files={files} />
      {words && <MineBubble text={words} />}
    </>
  );
}

// One of the user's messages, a long one cut short with a way to open it.
export function MineBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS;
  return (
    <>
      <div className={`bubble mine ${long && !open ? 'folded' : ''}`}>{text}</div>
      {long && (
        <button className="mine-more" onClick={() => setOpen(!open)}>
          {open ? t.collapse : t.expandAll}
        </button>
      )}
    </>
  );
}

// Under the last message sent: copy it, or go back to before it.
function MineActions({ text, onRewind }: { text: string; onRewind: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return (
    <>
      {text && <button onClick={copy}>{copied ? t.copied : t.copy}</button>}
      <button onClick={onRewind}>{t.rewind}</button>
    </>
  );
}
