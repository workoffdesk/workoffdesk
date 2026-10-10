import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposer, DRAFT_WAIT_MS, FILES_KEPT_MS, type ComposerDeps } from '../../src/composer/composer';
import { createDrafts } from '../../src/composer/drafts';
import { HOLD_MS } from '../../src/composer/hold';
import { withPieces, withPictures } from '../../src/chat/images';
import type { SlashCommand } from '../../src/composer/slash';
import { FINISH_MS, type Recognize } from '../../src/composer/talk';
import { flush, memoryStorage } from '../helpers/fakes';

const PICTURE = '/tmp/h/uploads/2026-10-03-191036-83c3d5.png';
const FILE = '"/tmp/h/uploads/2026-10-03-191300-cac205/notes.pdf"';
const VIDEO =
  '"/tmp/h/uploads/2026-10-03-191400-ab12cd/clip.mov" (video: 4 stills, one every 2 s, in "/tmp/h/uploads/2026-10-03-191400-ab12cd/stills/")';
const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact', source: 'builtin' },
  { name: 'clear', description: 'Clear', source: 'builtin' },
];

// A recognizer the test speaks through, counting how it was ended.
function recognizer() {
  type Said = { started: number; stopped: number; aborted: number; hears: (text: string) => void; ends: (error?: string) => void; starts: () => void };
  const r: Said = { started: 0, stopped: 0, aborted: 0, hears: () => {}, ends: () => {}, starts: () => {} };
  const recognize: Recognize = (onText, onEnd, onStart) => {
    r.started++;
    r.hears = onText;
    r.ends = onEnd;
    r.starts = onStart;
    return { stop: () => void r.stopped++, abort: () => void r.aborted++ };
  };
  return { r, recognize };
}

// A source the test can read back: where the composer would show the attachment from.
type Src = { from: string };

function setup(over: Partial<ComposerDeps<Src>> = {}, stored: Record<string, string> = {}) {
  const storage = memoryStorage(stored);
  const sent: string[] = [];
  const errors: string[] = [];
  const focused = { n: 0 };
  const { r, recognize } = recognizer();
  let going = true;
  const deps: ComposerDeps<Src> = {
    draftKey: 's1',
    drafts: createDrafts(storage),
    snippets: { lines: () => ['run the tests', 'commit it'] },
    onSend: (text) => {
      if (going) sent.push(text);
      return going;
    },
    onError: (m) => void errors.push(m),
    sourceOf: (kind, path) => ({ from: `${kind}:${path}` }),
    recognize,
    speech: true,
    speechFailed: () => false,
    focusField: () => void focused.n++,
    ...over,
  };
  const c = createComposer(deps);
  return { c, s: () => c.getSnapshot(), storage, sent, errors, focused, r, offline: () => (going = false) };
}

// An upload the test answers.
function upload() {
  let answer!: (piece: string) => void;
  let fail!: (e: unknown) => void;
  const fn = vi.fn(() => new Promise<string>((res, rej) => ((answer = res), (fail = rej))));
  return { fn, answer: (p: string) => answer(p), fail: (e: unknown) => fail(e) };
}

// Pressed, held past HOLD_MS, the microphone on, and these words heard.
function talk(x: ReturnType<typeof setup>, heard: string) {
  x.c.pressIn();
  vi.advanceTimersByTime(HOLD_MS);
  x.r.starts();
  x.r.hears(heard);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createComposer', () => {
  describe('the draft', () => {
    it('starts as what was kept for this session', () => {
      expect(setup({}, { 'workoffdesk.draft.s1': 'half a thought' }).s().text).toBe('half a thought');
    });

    it('is kept once typing pauses for DRAFT_WAIT_MS', () => {
      const x = setup();
      x.c.type('fix the');
      vi.advanceTimersByTime(DRAFT_WAIT_MS - 1);
      x.c.type('fix the build');
      vi.advanceTimersByTime(DRAFT_WAIT_MS - 1);
      expect(x.storage.data.get('workoffdesk.draft.s1')).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(x.storage.data.get('workoffdesk.draft.s1')).toBe('fix the build');
    });

    it('is kept at once when the composer is left', () => {
      const x = setup();
      x.c.type('on my way out');
      x.c.leave();
      expect(x.storage.data.get('workoffdesk.draft.s1')).toBe('on my way out');
    });

    it('is dropped once what was typed is sent', () => {
      const x = setup({}, { 'workoffdesk.draft.s1': 'go' });
      expect(x.c.send()).toBe(true);
      expect(x.storage.data.has('workoffdesk.draft.s1')).toBe(false);
      vi.advanceTimersByTime(DRAFT_WAIT_MS);
      expect(x.storage.data.has('workoffdesk.draft.s1')).toBe(false);
    });

    it('is not kept without a draft key', () => {
      const x = setup({ draftKey: undefined });
      x.c.type('nowhere');
      x.c.leave();
      expect(x.storage.data.size).toBe(0);
    });
  });

  describe('a refill', () => {
    it('goes above what is typed', () => {
      const x = setup();
      x.c.type('and then');
      x.c.refill({ text: 'first this', n: 1 });
      expect(x.s().text).toBe('first this\nand then');
    });

    it('goes in once per n, however often it is handed over', () => {
      const x = setup();
      x.c.refill({ text: 'again', n: 1 });
      x.c.refill({ text: 'again', n: 1 });
      expect(x.s().text).toBe('again');
      x.c.refill({ text: 'later', n: 2 });
      expect(x.s().text).toBe('later\nagain');
    });

    it('counts the one the composer starts with as already in', () => {
      const x = setup({ refill: { text: 'old', n: 4 } });
      x.c.refill({ text: 'old', n: 4 });
      expect(x.s().text).toBe('');
    });

    it('brings back the pictures, videos and files it was sent with, ahead of what is attached', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('file', 'later.txt', u.fn);
      x.c.refill({ text: withPieces([`"${PICTURE}"`, VIDEO, FILE], 'look'), n: 1 });
      expect(x.s().text).toBe('look');
      expect(x.s().attached.map(({ kind, name, piece, source }) => ({ kind, name, piece, source }))).toEqual([
        { kind: 'picture', name: PICTURE, piece: `"${PICTURE}"`, source: { from: `picture:${PICTURE}` } },
        { kind: 'video', name: 'clip.mov', piece: VIDEO, source: { from: 'video:/tmp/h/uploads/2026-10-03-191400-ab12cd/clip.mov' } },
        { kind: 'file', name: 'notes.pdf', piece: FILE, source: undefined },
        { kind: 'file', name: 'later.txt', piece: null, source: undefined },
      ]);
      await flush();
    });

    it('hands nothing back for null', () => {
      const x = setup();
      x.c.type('kept');
      x.c.refill(null);
      expect(x.s().text).toBe('kept');
    });
  });

  describe('sending', () => {
    it('sends the pieces before the words and empties the composer', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('picture', 'a.png', u.fn);
      u.answer(`"${PICTURE}"`);
      await flush();
      x.c.type('what is this');
      expect(x.c.send()).toBe(true);
      expect(x.sent).toEqual([withPictures([PICTURE], 'what is this')]);
      expect(x.s()).toMatchObject({ text: '', attached: [], empty: true, sent: 1 });
    });

    it('waits while something is still uploading', async () => {
      const x = setup();
      x.c.attach('picture', 'a.png', upload().fn);
      x.c.type('soon');
      expect(x.s().uploading).toBe(true);
      expect(x.c.send()).toBe(false);
      expect(x.sent).toEqual([]);
      expect(x.s().text).toBe('soon');
    });

    it('keeps everything when it could not go', () => {
      const x = setup();
      x.offline();
      x.c.type('still here');
      expect(x.c.send()).toBe(false);
      expect(x.s()).toMatchObject({ text: 'still here', sent: 0 });
    });
  });

  describe('the slash menu', () => {
    it('asks for the commands once and offers those that fit', async () => {
      const loadCommands = vi.fn(async () => COMMANDS);
      const x = setup({ loadCommands });
      x.c.type('/');
      x.c.type('/c');
      await flush();
      x.c.type('/co');
      expect(loadCommands).toHaveBeenCalledTimes(1);
      expect(x.s().offered.map((c) => c.name)).toEqual(['compact']);
    });

    it('asks again at the next change after it could not get them', async () => {
      const loadCommands = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(COMMANDS);
      const x = setup({ loadCommands });
      x.c.type('/');
      await flush();
      expect(x.s().offered).toEqual([]);
      x.c.type('/c');
      await flush();
      expect(loadCommands).toHaveBeenCalledTimes(2);
      expect(x.s().offered).toHaveLength(2);
    });

    it('offers the snippets that fit, and a pick fills the composer', () => {
      const x = setup();
      x.c.type('/test');
      expect(x.s().said).toEqual(['run the tests']);
      x.c.pickSnippet('run the tests');
      expect(x.s().text).toBe('run the tests');
      expect(x.focused.n).toBe(1);
    });

    it('writes a picked command out with a space after it', async () => {
      const x = setup({ loadCommands: async () => COMMANDS });
      x.c.type('/cl');
      await flush();
      x.c.pickCommand(x.s().offered[0]);
      expect(x.s()).toMatchObject({ text: '/clear ', offered: [], said: [] });
    });

    it('offers nothing once the name is complete', async () => {
      const x = setup({ loadCommands: async () => COMMANDS });
      x.c.type('/compact now');
      await flush();
      expect(x.s()).toMatchObject({ offered: [], said: [] });
    });
  });

  describe('the @ menu', () => {
    const FILES = ['src/app.ts', 'README.md'];

    it('asks for the files only while the field has focus', async () => {
      const loadFiles = vi.fn(async () => FILES);
      const x = setup({ loadFiles });
      x.c.type('look at @ap', 11);
      await flush();
      expect(loadFiles).not.toHaveBeenCalled();
      x.c.focus();
      await flush();
      expect(x.s().mentioned).toEqual(['src/app.ts']);
      x.c.blur();
      expect(x.s().mentioned).toEqual([]);
    });

    it('asks again after a failure only once the mention has ended', async () => {
      const loadFiles = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(FILES);
      const x = setup({ loadFiles });
      x.c.focus();
      x.c.type('@', 1);
      await flush();
      x.c.type('@a', 2);
      await flush();
      expect(loadFiles).toHaveBeenCalledTimes(1);
      x.c.type('', 0);
      x.c.type('@', 1);
      await flush();
      expect(loadFiles).toHaveBeenCalledTimes(2);
    });

    it('uses a listing for FILES_KEPT_MS, then asks again', async () => {
      const loadFiles = vi.fn(async () => FILES);
      const x = setup({ loadFiles });
      x.c.focus();
      x.c.type('@', 1);
      await flush();
      x.c.type('', 0);
      vi.advanceTimersByTime(FILES_KEPT_MS - 1);
      x.c.type('@', 1);
      await flush();
      expect(loadFiles).toHaveBeenCalledTimes(1);
      x.c.type('', 0);
      vi.advanceTimersByTime(1);
      x.c.type('@', 1);
      await flush();
      expect(loadFiles).toHaveBeenCalledTimes(2);
    });

    it('writes a picked file out whole and puts the caret after it', async () => {
      const x = setup({ loadFiles: async () => FILES });
      x.c.focus();
      x.c.type('see @ap and', 7);
      await flush();
      expect(x.c.pickFile('src/app.ts')).toBe(16);
      expect(x.s()).toMatchObject({ text: 'see @src/app.ts and', caret: 16 });
    });

    it('does nothing for a pick with no mention typed', () => {
      const x = setup();
      x.c.type('plain');
      expect(x.c.pickFile('src/app.ts')).toBeNull();
      expect(x.s().text).toBe('plain');
    });
  });

  describe('attachments', () => {
    it('shows a picture with no piece while it uploads, then gives it its piece and keeps its own source', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('picture', 'a.png', u.fn, { from: 'phone' });
      expect(x.s().attached).toMatchObject([{ kind: 'picture', name: 'a.png', piece: null, source: { from: 'phone' } }]);
      expect(x.s()).toMatchObject({ uploading: true, empty: false });
      u.answer(`"${PICTURE}"`);
      await flush();
      expect(x.s().attached).toMatchObject([{ piece: `"${PICTURE}"`, source: { from: 'phone' } }]);
      expect(x.s().uploading).toBe(false);
    });

    it('shows a picture with no source of its own from the Mac once it is there', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('picture', 'a.png', u.fn);
      expect(x.s().attached[0].source).toBeUndefined();
      u.answer(`"${PICTURE}"`);
      await flush();
      expect(x.s().attached[0].source).toEqual({ from: `picture:${PICTURE}` });
    });

    it('shows a video by its still once it is on the Mac', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('video', 'clip.mov', u.fn);
      u.answer(VIDEO);
      await flush();
      expect(x.s().attached[0].source).toEqual({ from: 'video:/tmp/h/uploads/2026-10-03-191400-ab12cd/clip.mov' });
    });

    it('drops one that fails and says why, by its kind', async () => {
      const x = setup();
      const pic = upload();
      const file = upload();
      x.c.attach('picture', 'a.png', pic.fn);
      x.c.attach('file', 'notes.pdf', file.fn);
      pic.fail(new Error('boom'));
      file.fail(new Error('boom'));
      await flush();
      expect(x.s().attached).toEqual([]);
      expect(x.errors).toEqual([t.uploadFailed, t.fileUploadFailed('notes.pdf')]);
    });

    it('hands the upload the key its progress goes to', async () => {
      const x = setup();
      const u = upload();
      const key = x.c.attach('file', 'big.zip', u.fn);
      expect(u.fn).toHaveBeenCalledWith(key);
      x.c.progress(key, 0.4);
      expect(x.s().attached[0].sent).toBe(0.4);
    });

    it('drops one taken off for good, even when its upload finishes later', async () => {
      const x = setup();
      const u = upload();
      const key = x.c.attach('picture', 'a.png', u.fn);
      x.c.remove(key);
      u.answer(`"${PICTURE}"`);
      await flush();
      expect(x.s().attached).toEqual([]);
    });
  });

  describe('hold to talk', () => {
    it('treats a press released before HOLD_MS as a tap and listens to nothing', () => {
      const x = setup();
      x.c.pressIn();
      vi.advanceTimersByTime(HOLD_MS - 1);
      expect(x.c.letGo('send')).toBe('tap');
      expect(x.r.started).toBe(0);
      expect(x.s().hold).toBeNull();
    });

    it('treats a press as a tap with speech off', () => {
      const x = setup({ speech: false });
      x.c.pressIn();
      vi.advanceTimersByTime(HOLD_MS);
      expect(x.r.started).toBe(0);
      expect(x.c.letGo('send')).toBe('tap');
    });

    it('never treats a press the platform takes away as a tap', () => {
      const x = setup();
      x.c.pressIn();
      expect(x.c.letGo(null)).toBe('none');
      expect(x.c.letGo(null)).toBe('none');
    });

    it('shows what is heard while held and sends it once released', async () => {
      const x = setup();
      talk(x, 'run the tests');
      expect(x.s().hold).toMatchObject({ listening: true, heard: 'run the tests' });
      expect(x.c.letGo('send')).toBe('held');
      x.r.ends();
      await flush();
      expect(x.sent).toEqual(['run the tests']);
      expect(x.s().hold).toBeNull();
    });

    it('sends nothing when slid onto Cancel', () => {
      const x = setup();
      talk(x, 'never mind');
      x.c.move('cancel');
      expect(x.s().hold?.zone).toBe('cancel');
      x.c.letGo('cancel');
      vi.advanceTimersByTime(FINISH_MS);
      expect(x.sent).toEqual([]);
      expect(x.r.aborted).toBe(1);
    });

    it('puts the words into the field and focuses it when slid onto To text', () => {
      const x = setup();
      talk(x, 'look this over');
      x.c.letGo('text');
      expect(x.s().text).toBe('look this over');
      expect(x.focused.n).toBe(1);
      vi.advanceTimersByTime(FINISH_MS);
      expect(x.sent).toEqual([]);
    });

    it('sends what is attached with the words', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('file', 'notes.pdf', u.fn);
      u.answer(FILE);
      await flush();
      talk(x, 'read this');
      x.c.letGo('send');
      x.r.ends();
      await flush();
      expect(x.sent).toEqual([withPieces([FILE], 'read this')]);
      expect(x.s().attached).toEqual([]);
    });

    it('waits for a picture still uploading and sends the words with it once it is up', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('picture', 'a.png', u.fn);
      talk(x, 'what is this');
      x.c.letGo('send');
      x.r.ends();
      await flush();
      expect(x.sent).toEqual([]);
      u.answer(`"${PICTURE}"`);
      await flush();
      expect(x.sent).toEqual([withPictures([PICTURE], 'what is this')]);
      expect(x.s().attached).toEqual([]);
    });

    it('keeps the words in the field, unsent, when the picture they waited for fails', async () => {
      const x = setup();
      const u = upload();
      x.c.attach('picture', 'a.png', u.fn);
      talk(x, 'what is this');
      x.c.letGo('send');
      x.r.ends();
      u.fail(new Error('boom'));
      await flush();
      expect(x.sent).toEqual([]);
      expect(x.s().text).toBe('what is this');
      expect(x.s().sending).toBe(false);
      expect(x.errors).toEqual([t.uploadFailed]);
    });

    it('sends an attachment added while the words wait along with them once it is up too', async () => {
      const x = setup();
      const first = upload();
      x.c.attach('picture', 'a.png', first.fn);
      talk(x, 'this one');
      x.c.letGo('send');
      x.r.ends();
      const second = upload();
      x.c.attach('file', 'notes.pdf', second.fn);
      first.answer(`"${PICTURE}"`);
      await flush();
      expect(x.sent).toEqual([]);
      expect(x.s().attached.map((a) => a.name)).toEqual(['a.png', 'notes.pdf']);
      second.answer(FILE);
      await flush();
      expect(x.sent).toEqual([withPieces([`"${PICTURE}"`, FILE], 'this one')]);
      expect(x.s().attached).toEqual([]);
    });

    it('keeps the words in the field when they could not go', async () => {
      const x = setup();
      x.offline();
      talk(x, 'try again later');
      x.c.letGo('send');
      x.r.ends();
      await flush();
      expect(x.s().text).toBe('try again later');
    });

    it('stops offering speech the platform says is off for good', () => {
      const x = setup({ speechFailed: (e) => e === 'service-not-allowed' });
      talk(x, '');
      x.r.ends('network');
      x.c.letGo('send');
      expect(x.s().speech).toBe(true);
      talk(x, '');
      x.r.ends('service-not-allowed');
      expect(x.s().speech).toBe(false);
    });

    it('drops the hold when the composer is left, and a press still waiting never starts listening', () => {
      const x = setup();
      talk(x, 'half');
      x.c.leave();
      expect(x.r.aborted).toBe(1);
      expect(x.s().hold).toBeNull();
      x.c.pressIn();
      x.c.dropTalk();
      vi.advanceTimersByTime(HOLD_MS);
      expect(x.r.started).toBe(1);
    });

    it('works again after being left, as a screen mounted twice uses it', async () => {
      const x = setup();
      x.c.leave();
      talk(x, 'still here');
      x.c.letGo('send');
      x.r.ends();
      await flush();
      expect(x.sent).toEqual(['still here']);
    });
  });

  describe('the snapshot', () => {
    it('stays the same object until something changes, and tells its listeners when it does', () => {
      const x = setup();
      const before = x.s();
      expect(x.s()).toBe(before);
      const told = vi.fn();
      const stop = x.c.subscribe(told);
      x.c.type('a');
      expect(told).toHaveBeenCalledTimes(1);
      expect(x.s()).not.toBe(before);
      stop();
      x.c.type('ab');
      expect(told).toHaveBeenCalledTimes(1);
    });
  });
});
