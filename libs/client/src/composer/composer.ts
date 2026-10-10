import { t } from '@workoffdesk/i18n';
import { errorText } from '../base/api';
import { startPress, type Press } from './hold';
import { picturesApart, sentFiles, withPieces } from '../chat/images';
import { matchCommands, matchFiles, mentionAt, slashQuery, withMention, type SlashCommand } from './slash';
import { matchSnippets } from './snippets';
import { startTalk, type Hold, type Recognize, type Talk, type Zone } from './talk';

// How long typing pauses before the draft is kept.
export const DRAFT_WAIT_MS = 500;
// How long a listing of the folder's files is used before it is asked for again.
export const FILES_KEPT_MS = 30_000;

export type AttachmentKind = 'picture' | 'video' | 'file';

// What waits above the text to go with it. piece: what the message carries for it (its quoted path on the
// Mac), null while it uploads; sent: how much of it is up, 0 to 1; source: what the platform shows it with.
export type Attachment<S> = { key: string; kind: AttachmentKind; name: string; piece: string | null; sent?: number; source?: S };

// Text handed back to the composer (a message taken back, one that did not go); each new n puts it in.
export type Refill = { text: string; n: number };

export type ComposerDeps<S> = {
  // Where what is typed and not sent is kept; nowhere without one.
  draftKey?: string;
  drafts: { draftOf(key: string): string; keepDraft(key: string, text: string): void };
  snippets: { lines(): string[] };
  // The commands Claude takes after a `/` here.
  loadCommands?: () => Promise<SlashCommand[]>;
  // The files of the session's folder an `@` can name.
  loadFiles?: () => Promise<string[]>;
  // Sends the text followed by Enter; false when it could not go.
  onSend: (text: string) => boolean;
  onError: (message: string) => void;
  // How something already on the Mac is shown: a picture by its path, a video by its still.
  sourceOf: (kind: 'picture' | 'video', path: string) => S | undefined;
  recognize: Recognize;
  // Whether this platform can recognize speech at all.
  speech: boolean;
  // Tells the user why listening stopped; true when speech is off for good here.
  speechFailed: (error: string) => boolean;
  // Brings the keyboard up, inside the event that asked for it.
  focusField: () => void;
  // The refill the composer starts with, taken as already in.
  refill?: Refill | null;
};

export type ComposerSnapshot<S> = {
  text: string;
  caret: number;
  focused: boolean;
  attached: Attachment<S>[];
  uploading: boolean;
  // Sent while something uploads: it goes as it stands once all is up.
  sending: boolean;
  // Nothing typed and nothing attached.
  empty: boolean;
  // The commands and snippets that fit a `/`, and the files that fit an `@`.
  offered: SlashCommand[];
  said: string[];
  mentioned: string[];
  // The panel over the composer while a hold lasts.
  hold: Hold | null;
  speech: boolean;
  // How many messages went from here.
  sent: number;
};

export type Composer<S> = ReturnType<typeof createComposer<S>>;

const unquoted = (piece: string) => piece.replace(/^"(.*)"$/, '$1');

// What is typed to a session, what waits to go with it, and holding the empty bar to talk. The platform
// draws it and reports the finger and the field; everything that decides is here.
export function createComposer<S>(deps: ComposerDeps<S>) {
  const { draftKey, drafts } = deps;
  const lines = deps.snippets.lines();
  let text = draftKey ? drafts.draftOf(draftKey) : '';
  let caret = 0;
  let focused = false;
  let attached: Attachment<S>[] = [];
  let hold: Hold | null = null;
  let speech = deps.speech;
  let sent = 0;
  let refilled = deps.refill?.n ?? null;
  let commands: SlashCommand[] | null = null;
  let askingCommands = false;
  let files: { at: number; list: string[] } | null = null;
  let askingFiles = false;
  let filesFailed = false;
  let count = 0;
  let press: Press | null = null;
  let talk: Talk | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  const listeners = new Set<() => void>();

  const mention = () => (focused ? mentionAt(text, caret) : null);
  const uploading = () => attached.some((a) => a.piece === null);

  const keepDraft = () => {
    clearTimeout(draftTimer);
    if (draftKey) drafts.keepDraft(draftKey, text);
  };

  // Asks for what a menu needs now, if it has not got it.
  const look = () => {
    if (slashQuery(text) !== null && !commands && !askingCommands && deps.loadCommands) {
      askingCommands = true;
      deps.loadCommands().then(
        (all) => {
          askingCommands = false;
          commands = all;
          changed();
        },
        () => (askingCommands = false),
      );
    }
    const m = mention();
    if (!m) filesFailed = false;
    else if (deps.loadFiles && !askingFiles && !filesFailed && !(files && Date.now() - files.at < FILES_KEPT_MS)) {
      askingFiles = true;
      deps.loadFiles().then(
        (list) => {
          askingFiles = false;
          files = { at: Date.now(), list };
          changed();
        },
        () => {
          askingFiles = false;
          filesFailed = true;
        },
      );
    }
  };

  const shown = (): ComposerSnapshot<S> => {
    const query = slashQuery(text);
    const m = mention();
    return {
      text,
      caret,
      focused,
      attached,
      uploading: uploading(),
      sending,
      empty: !text && !attached.length,
      offered: query !== null && commands ? matchCommands(commands, query) : [],
      said: query !== null ? matchSnippets(lines, query) : [],
      mentioned: m && files ? matchFiles(files.list, m.query) : [],
      hold,
      speech,
      sent,
    };
  };
  let snapshot = shown();
  const changed = () => {
    snapshot = shown();
    for (const l of [...listeners]) l();
  };

  const setText = (next: string) => {
    if (next !== text && draftKey) {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(keepDraft, DRAFT_WAIT_MS);
    }
    text = next;
  };
  const update = (attachment: string, to: (a: Attachment<S>) => Attachment<S>) => {
    attached = attached.map((a) => (a.key === attachment ? to(a) : a));
  };
  // How one just uploaded is shown: a picture as it was, or from the Mac; a video by its still.
  const shownFrom = (a: Attachment<S>, piece: string): S | undefined => {
    if (a.kind === 'file') return a.source;
    if (a.kind === 'picture') return a.source ?? deps.sourceOf('picture', unquoted(piece));
    const path = sentFiles(piece)[0]?.path;
    return path ? deps.sourceOf('video', path) : a.source;
  };
  const removeAll = (keys: string[]) => {
    attached = attached.filter((a) => !keys.includes(a.key));
  };

  // Sends what is in the field and attached, or, while something uploads, sends it once all is up; false
  // when it has not gone yet, everything kept.
  const send = (): boolean => {
    if (uploading()) {
      sending = true;
      return false;
    }
    sending = false;
    if (!deps.onSend(withPieces(attached.map((a) => a.piece!), text))) return false;
    text = '';
    attached = [];
    sent++;
    keepDraft();
    return true;
  };

  // What was heard is sent as if typed, so it waits in the field for what is still uploading.
  const sendHeard = (heard: string) => {
    setText(heard);
    caret = heard.length;
    send();
    changed();
  };

  const startHold = () => {
    talk = startTalk(deps.recognize, {
      show: (h) => {
        hold = h;
        changed();
      },
      write: (heard) => {
        deps.focusField();
        setText(heard);
        caret = heard.length;
        changed();
      },
      send: sendHeard,
      failed: (error) => {
        if (deps.speechFailed(error)) {
          speech = false;
          changed();
        }
      },
      say: deps.onError,
    });
  };

  const dropTalk = () => {
    press?.end();
    press = null;
    talk?.drop();
    talk = null;
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: (): ComposerSnapshot<S> => snapshot,

    // The field changed: its text, and where the caret is when the platform knows it with the text.
    type(next: string, at?: number) {
      setText(next);
      if (at !== undefined) caret = at;
      look();
      changed();
    },
    setCaret(at: number) {
      caret = at;
      look();
      changed();
    },
    focus() {
      focused = true;
      look();
      changed();
    },
    blur() {
      focused = false;
      look();
      changed();
    },

    refill(r: Refill | null) {
      if (!r || r.n === refilled) return;
      refilled = r.n;
      const back = picturesApart(r.text);
      setText(text && back.text ? `${back.text}\n${text}` : back.text || text);
      const key = () => `attached-${++count}`;
      attached = [
        ...back.pictures.map((path) => ({ key: key(), kind: 'picture' as const, name: path, piece: `"${path}"`, source: deps.sourceOf('picture', path) })),
        ...back.files.map((f) => ({
          key: key(),
          kind: f.video ? ('video' as const) : ('file' as const),
          name: f.name,
          piece: f.piece,
          source: f.video ? deps.sourceOf('video', f.path) : undefined,
        })),
        ...attached,
      ];
      look();
      changed();
    },

    // Adds one to go with the text, uploading it with upload, which is handed the attachment's key for
    // progress. Answers with that key.
    attach(kind: AttachmentKind, name: string, upload: (key: string) => Promise<string>, source?: S): string {
      const key = `attached-${++count}`;
      attached = [...attached, { key, kind, name, piece: null, source }];
      void (async () => upload(key))().then(
        (piece) => {
          update(key, (a) => ({ ...a, piece, source: shownFrom(a, piece) }));
          if (sending) send();
          changed();
        },
        // What was to go with it does not go without it.
        (e: unknown) => {
          removeAll([key]);
          sending = false;
          const what = kind === 'picture' ? t.uploadFailed : t.fileUploadFailed(name);
          const why = errorText(e, what);
          deps.onError(why === what ? what : t.whatAndWhy(what, why));
          changed();
        },
      );
      changed();
      return key;
    },
    progress(key: string, share: number) {
      update(key, (a) => ({ ...a, sent: share }));
      changed();
    },
    // Taking one away is changing what goes: a send waiting for it is off.
    remove(key: string) {
      removeAll([key]);
      sending = false;
      changed();
    },

    // Sends what is typed and attached; false, keeping it all, while it waits for an upload or when it did not go.
    send(): boolean {
      const went = send();
      changed();
      return went;
    },

    pickCommand(c: SlashCommand) {
      deps.focusField();
      setText(`/${c.name} `);
      changed();
    },
    pickSnippet(line: string) {
      deps.focusField();
      setText(line);
      changed();
    },
    // Writes out the file the `@` being typed names; answers where the caret goes, null with no `@` typed.
    pickFile(path: string): number | null {
      const m = mention();
      if (!m) return null;
      const next = withMention(text, caret, m, path);
      setText(next.text);
      caret = next.caret;
      look();
      changed();
      return next.caret;
    },

    // The finger on the empty bar: held for HOLD_MS it talks.
    pressIn() {
      if (!speech) return;
      dropTalk();
      press = startPress(startHold);
    },
    move(zone: Zone) {
      if (press?.held()) talk?.move(zone);
    },
    // The finger up over zone, or null when the platform took the press away. A tap is for the platform
    // to bring the keyboard up; one taken away is never a tap.
    letGo(zone: Zone | null): 'tap' | 'held' | 'none' {
      const p = press;
      press = null;
      if (!p || p.end() === 'tap') return zone === null ? 'none' : 'tap';
      if (zone) talk?.release(zone);
      else talk?.drop();
      talk = null;
      return 'held';
    },
    dropTalk,

    // The screen is going: what is typed is kept now and listening ends. Still usable, as a screen
    // mounted again at once uses it.
    leave() {
      keepDraft();
      dropTalk();
    },
  };
}
