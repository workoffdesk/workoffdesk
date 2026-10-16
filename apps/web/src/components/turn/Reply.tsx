import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { imageKey, replyImages } from '@workoffdesk/client/chat/images';
import { bestVoice } from '@workoffdesk/client/chat/readAloud';
import { markdownHtml } from '../../markdown';
import { speechLocale, t } from '@workoffdesk/i18n';
import { type Opener, Pictures } from './media';

// The sanitizer lets no button through, so each code block's copy button is put in after rendering.
export const COPIED_MS = 1500;

export const Reply = memo(function Reply({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const html = markdownHtml(text);
  useEffect(() => {
    for (const block of box.current?.querySelectorAll('.code-block') ?? []) {
      if (block.querySelector('.code-copy')) continue;
      const b = document.createElement('button');
      b.className = 'code-copy';
      b.type = 'button';
      b.textContent = t.copy;
      block.append(b);
    }
  }, [html]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const b = (e.target as HTMLElement).closest('.code-copy');
    const code = b?.parentElement?.querySelector('code')?.textContent;
    if (!b || code == null) return;
    void navigator.clipboard?.writeText(code).then(() => {
      b.textContent = t.copied;
      setTimeout(() => (b.textContent = t.copy), COPIED_MS);
    });
  };
  return <div ref={box} className="reply" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});

// Under the end of a reply: copy what Claude said, or have the phone read it out.
function ReplyActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  // What this reply is reading out stops with it, when the chat it is in goes away.
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(
    () => () => {
      if (utterance.current) window.speechSynthesis?.cancel();
    },
    [],
  );
  const copy = () =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const read = () => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    speech.cancel();
    if (reading) return setReading(false);
    const u = new SpeechSynthesisUtterance(text.replace(/[`*#>_~|-]+/g, ' '));
    u.lang = speechLocale;
    const voices = speech.getVoices();
    const best = bestVoice(voices.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang })), speechLocale);
    u.voice = voices.find((v) => v.voiceURI === best) ?? null;
    u.onend = u.onerror = () => {
      if (utterance.current === u) utterance.current = null;
      setReading(false);
    };
    utterance.current = u;
    setReading(true);
    speech.speak(u);
  };
  return (
    <div className="reply-actions">
      <button onClick={copy}>{copied ? t.copied : t.copy}</button>
      {'speechSynthesis' in window && <button onClick={read}>{reading ? t.stopReading : t.readAloud}</button>}
    </div>
  );
}

// A reply with the images on this Mac it names under it, unless the chat shows them already, and web
// images only as links to them.
export function ReplyWithImages(props: { sessionId: string; text: string; repeated?: Set<string>; onOpen: Opener; last?: boolean }) {
  const { sessionId, repeated, onOpen } = props;
  const { text: words, local, remote } = replyImages(props.text);
  return (
    <>
      <Reply text={words} />
      {props.last && <ReplyActions text={words} />}
      <Pictures sessionId={sessionId} side="theirs" paths={local.filter((p) => !repeated?.has(p))} onOpen={onOpen} />
      {remote.length > 0 && (
        <div className="chat-web-images">
          {remote.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {t.webImage} · {hostOf(url)}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

// A picture the chat already shows further up: a way back to it instead of a second copy.
export function ShownAbove({ path }: { path: string }) {
  const back = (e: MouseEvent<HTMLButtonElement>) =>
    e.currentTarget
      .closest('.chat')
      ?.querySelector(`[data-image="${CSS.escape(imageKey(path))}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return (
    <button className="chat-shown-above" onClick={back}>
      {t.seeImageAbove}
    </button>
  );
}
