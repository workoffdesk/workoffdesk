import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createComposer } from '@workoffdesk/client/composer/composer';
import { newUploadId, sendFile } from '@workoffdesk/client/chat/fileUpload';
import { coverUrl, filePiece, uploadUrl } from '@workoffdesk/client/chat/images';
import { pastedFiles } from '@workoffdesk/client/composer/pasted';
import { describe, type SlashCommand } from '@workoffdesk/client/composer/slash';
import { speechErrorText, type Zone } from '@workoffdesk/client/composer/talk';
import { t } from '@workoffdesk/i18n';
import { api } from '../api';
import { IconCamera, IconDoc, IconImage, IconKeys, IconPlus, IconUp } from '../icons';
import { drafts, snippets } from '../platform';
import { useStore } from '../store';
import { hasLiveSpeech, startLiveSpeech } from '../voice';
import { AttachmentTile } from './composer/AttachmentTile';
import { VoicePanel } from './composer/VoicePanel';

type Props = {
  // Sends the text followed by Enter; false when it could not go.
  onSend: (text: string) => boolean;
  // Answers with the path the image was saved at, which goes into the text.
  onUpload: (file: File) => Promise<string>;
  onError: (message: string) => void;
  // The commands Claude takes after a `/` here, asked for the first time one is typed.
  loadCommands?: () => Promise<SlashCommand[]>;
  // The files of the session's folder an `@` can name, asked for when one is typed.
  loadFiles?: () => Promise<string[]>;
  // Text handed back to the composer (a message taken back, one that did not go); each new `n` puts it in.
  refill?: { text: string; n: number } | null;
  // While Claude works, an empty composer offers to stop it where the send button would be.
  onStop?: () => void;
  // Shown under the input, inside the composer.
  footer?: React.ReactNode;
  // Where what is typed and not sent is kept, to be there again when the composer comes back.
  draftKey?: string;
  // The key bar above the composer, which a button here shows and hides.
  keys?: { shown: boolean; onToggle: () => void };
};

// How far beyond its round edge a target still takes the finger.
const REACH_PX = 16;
// 5pt apart across about 270pt, as wide as Doubao's.

// The target under the finger, as drawn; anywhere off the targets sends.
function zoneAt(e: { clientX: number; clientY: number }): Zone {
  for (const dot of document.querySelectorAll<HTMLElement>('.voice-target-dot[data-zone]')) {
    const r = dot.getBoundingClientRect();
    const off = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (off <= r.width / 2 + REACH_PX) return dot.dataset.zone as Zone;
  }
  return 'send';
}

// A plain textarea for typing through an input method; what it does is the composer store's (composer.ts).
// Text leaves only once the input method has committed it. Holding the empty bar talks, through the
// browser's own recognizer.
export function Composer(props: Props) {
  const { onStop, footer, keys } = props;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const area = useRef<HTMLTextAreaElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [composer] = useState(() =>
    createComposer<string>({
      draftKey: props.draftKey,
      drafts,
      snippets,
      loadCommands: props.loadCommands && (() => latest.current.loadCommands!()),
      loadFiles: props.loadFiles && (() => latest.current.loadFiles!()),
      onSend: (text) => latest.current.onSend(text),
      onError: (message) => latest.current.onError(message),
      sourceOf: (kind, path) => (kind === 'picture' ? uploadUrl(path) : coverUrl(path)),
      recognize: startLiveSpeech,
      speech: hasLiveSpeech(),
      speechFailed: (error) => {
        if (error === 'service-not-allowed') latest.current.onError(t.speechBlocked);
        else latest.current.onError(error === 'not-allowed' ? t.speechDenied : speechErrorText(error));
        return error === 'service-not-allowed';
      },
      // Inside the finger's own event, or iOS will not bring up the keyboard.
      focusField: () => area.current?.focus(),
      refill: props.refill,
    }),
  );
  const c = useStore(composer);
  useEffect(() => {
    composer.refill(props.refill ?? null);
  }, [composer, props.refill]);
  useEffect(() => () => composer.leave(), [composer]);

  useLayoutEffect(() => {
    const a = area.current!;
    a.style.height = '';
    if (c.text) a.style.height = `${Math.min(a.scrollHeight, 120)}px`;
  }, [c.text]);

  const send = () => {
    // The keyboard goes away so the answer can be read; a tap on the text brings it back.
    if (!composing.current && composer.send()) area.current?.blur();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // keyCode 229 is the Enter that Safari delivers after compositionend to confirm a candidate.
    if (composing.current || e.nativeEvent.keyCode === 229) return;
    e.preventDefault();
    send();
  };

  // Pictures, videos and files, from the menu over the plus as the phone has it, or pasted.
  const sentOf = (key: string) => (share: number) => composer.progress(key, share);
  const attach = (picked: File[]) => {
    for (const f of picked) {
      if (f.type.startsWith('image/')) composer.attach('picture', f.name, async () => `"${await latest.current.onUpload(f)}"`);
      else composer.attach(f.type.startsWith('video/') ? 'video' : 'file', f.name, (key) => uploadFile(f, sentOf(key)));
    }
  };
  const add = (input: HTMLInputElement) => {
    const picked = [...(input.files ?? [])];
    input.value = '';
    attach(picked);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedFiles(e.clipboardData);
    if (!pasted.length) return;
    e.preventDefault();
    attach(pasted);
  };
  const [menuShown, setMenuShown] = useState(false);
  const pickFrom = (input: HTMLInputElement | null) => {
    setMenuShown(false);
    input?.click();
  };
  const choose = () => {
    area.current?.blur();
    setMenuShown(true);
  };

  const name = (path: string) => {
    const at = composer.pickFile(path);
    if (at === null) return;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  };

  // A tap types. The click that follows a hold is the end of the hold, not a tap.
  const letGo = useRef<'tap' | 'held' | 'none'>('tap');
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!c.speech) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    composer.pressIn();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (c.hold) composer.move(zoneAt(e));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    letGo.current = composer.letGo(e.type === 'pointercancel' ? null : zoneAt(e));
  };
  const onBarClick = () => {
    const was = letGo.current;
    letGo.current = 'tap';
    if (was === 'tap') area.current?.focus();
  };

  const showBar = !c.text && !c.focused;

  return (
    <div className={c.attached.length || c.offered.length || c.said.length || c.mentioned.length ? 'composer with-pictures' : 'composer'}>
      {c.offered.length + c.said.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label={t.commands}>
          {c.said.map((line) => (
            <button
              key={`said-${line}`}
              role="option"
              aria-selected={false}
              aria-label={t.snippet(line)}
              className="snippet"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => composer.pickSnippet(line)}
            >
              <b>{line}</b>
              <span>{t.snippets}</span>
            </button>
          ))}
          {c.offered.map((cmd) => (
            <button
              key={cmd.name}
              role="option"
              aria-selected={false}
              aria-label={`/${cmd.name} ${describe(cmd)}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => composer.pickCommand(cmd)}
            >
              <b>/{cmd.name}</b>
              <span>{describe(cmd)}</span>
            </button>
          ))}
        </div>
      )}
      {c.mentioned.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label={t.files}>
          {c.mentioned.map((path) => {
            const cut = path.lastIndexOf('/') + 1;
            return (
              <button
                key={path}
                role="option"
                aria-selected={false}
                aria-label={`@${path}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => name(path)}
              >
                <b>{path.slice(cut)}</b>
                {cut > 0 && <span>{path.slice(0, cut)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {c.attached.length > 0 && (
        <div className="attachments">
          {c.attached.map((a) => (
            <AttachmentTile key={a.key} a={a} onRemove={() => composer.remove(a.key)} />
          ))}
        </div>
      )}
      <div className="composer-row">
        <button className="tool attach" aria-label={t.attach} aria-expanded={menuShown} onClick={choose}>
          <IconPlus />
        </button>
        {menuShown && (
          <>
            <div className="sources-catcher" onClick={() => setMenuShown(false)} />
            <div className="sources" role="menu">
              <button role="menuitem" onClick={() => pickFrom(library.current)}>
                <IconImage />
                {t.photosAndVideos}
              </button>
              {/* A camera only where there is one to hold: a computer opens its file picker for it. */}
              {canTakePhotos() && (
                <button role="menuitem" onClick={() => pickFrom(camera.current)}>
                  <IconCamera />
                  {t.takePhoto}
                </button>
              )}
              <button role="menuitem" onClick={() => pickFrom(files.current)}>
                <IconDoc />
                {t.pickFile}
              </button>
            </div>
          </>
        )}
        <input ref={library} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => add(e.currentTarget)} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.currentTarget)} />
        <input ref={files} type="file" multiple hidden onChange={(e) => add(e.currentTarget)} />
        <div className="composer-field">
          <textarea
            ref={area}
            aria-label={t.input}
            rows={1}
            value={c.text}
            enterKeyHint="send"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => composer.type(e.target.value, e.target.selectionStart)}
            onSelect={(e) => composer.setCaret(e.currentTarget.selectionStart)}
            onFocus={() => composer.focus()}
            onBlur={() => composer.blur()}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {showBar && (
            <button
              className="hold-bar"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={onBarClick}
              onContextMenu={(e) => e.preventDefault()}
            >
              {c.speech ? t.placeholderSpeech : t.placeholder}
            </button>
          )}
        </div>
        {onStop && c.empty && (
          <button className="send stop" aria-label={t.stop} onPointerDown={(e) => e.preventDefault()} onClick={onStop}>
            <span className="send-dot">
              <span className="stop-square" />
            </span>
          </button>
        )}
        {!c.empty && (
          <button
            className="send"
            aria-label={c.sending ? t.sending : t.send}
            disabled={c.sending}
            onPointerDown={(e) => e.preventDefault()}
            onClick={send}
          >
            <span className="send-dot">{c.sending ? <span className="spinner" /> : <IconUp />}</span>
          </button>
        )}
      </div>
      {(footer || keys) && (
        <div className="composer-foot">
          <div className="composer-foot-main">{footer}</div>
          {keys && (
            <button
              className={keys.shown ? 'keys-toggle shown' : 'keys-toggle'}
              aria-label={keys.shown ? t.hideKeys : t.showKeys}
              aria-pressed={keys.shown}
              onPointerDown={(e) => e.preventDefault()}
              onClick={keys.onToggle}
            >
              <IconKeys />
            </button>
          )}
        </div>
      )}
      {c.hold && <VoicePanel hold={c.hold} />}
    </div>
  );
}

// A video or a file goes up in parts, read a part at a time, so a large one is never held whole.
async function uploadFile(file: File, sent: (share: number) => void): Promise<string> {
  const read = async (at: number, length: number) => new Uint8Array(await file.slice(at, at + length).arrayBuffer());
  return filePiece(await sendFile(api, { id: newUploadId(), name: file.name, size: file.size, read }, (n) => sent(file.size ? n / file.size : 1)));
}

const canTakePhotos = () => matchMedia('(pointer: coarse)').matches;
