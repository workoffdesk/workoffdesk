import { dictionaries, t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINISH_MS, type Hold, type Recognize, speechErrorText, startTalk, type TalkTo } from '../../src/composer/talk';

// A recognizer the test speaks through: it hears, starts and ends when told to.
function recognizer() {
  const r: { stops: number; aborts: number; hears: (heard: string) => void; ends: (error?: string) => void; starts: () => void } = {
    stops: 0,
    aborts: 0,
    hears: () => {},
    ends: () => {},
    starts: () => {},
  };
  const recognize: Recognize = (onText, onEnd, onStart) => {
    r.hears = onText;
    r.ends = onEnd;
    r.starts = onStart;
    return { stop: () => void r.stops++, abort: () => void r.aborts++ };
  };
  return { r, recognize };
}

function talkTo() {
  const shown: (Hold | null)[] = [];
  const written: string[] = [];
  const sent: string[] = [];
  const failed: string[] = [];
  const said: string[] = [];
  const to: TalkTo = {
    show: (h) => void shown.push(h),
    write: (text) => void written.push(text),
    send: (heard) => void sent.push(heard),
    failed: (e) => void failed.push(e),
    say: (m) => void said.push(m),
  };
  return { to, shown, written, sent, failed, said, last: () => shown.at(-1) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startTalk', () => {
  it('shows what is heard as it comes, and the microphone once it is on', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    startTalk(recognize, o.to);
    expect(o.last()).toEqual({ listening: false, heard: '', zone: 'send', finishing: false });
    r.starts();
    expect(o.last()).toMatchObject({ listening: true });
    r.hears('look at');
    r.hears('look at this error');
    expect(o.last()).toMatchObject({ listening: true, heard: 'look at this error' });
  });

  it('sends once the recognizer has ended after the hold is released', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('look at');
    talk.release('send');
    expect(r.stops).toBe(1);
    expect(o.last()).toMatchObject({ finishing: true });
    expect(o.sent).toEqual([]);
    r.hears('look at this error');
    r.ends();
    expect(o.sent).toEqual(['look at this error']);
    expect(o.last()).toBeNull();
    vi.advanceTimersByTime(FINISH_MS * 2);
    expect(o.sent).toHaveLength(1);
  });

  it('sends what it has after FINISH_MS when the recognizer never ends', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('got it');
    talk.release('send');
    vi.advanceTimersByTime(FINISH_MS - 1);
    expect(o.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(o.sent).toEqual(['got it']);
    expect(r.aborts).toBe(1);
    expect(o.last()).toBeNull();
    r.hears('got it, late');
    r.ends();
    expect(o.sent).toEqual(['got it']);
  });

  it('sends at once when released after the recognizer stopped by itself', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('done talking');
    r.ends();
    talk.release('send');
    expect(o.sent).toEqual(['done talking']);
    expect(r.stops).toBe(0);
  });

  it('drops what was heard and sends nothing when released onto cancel', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('never mind');
    talk.move('cancel');
    expect(o.last()).toMatchObject({ zone: 'cancel' });
    talk.release('cancel');
    expect(r.aborts).toBe(1);
    expect(o.last()).toBeNull();
    r.ends('aborted');
    vi.advanceTimersByTime(FINISH_MS * 2);
    expect(o.sent).toEqual([]);
    expect(o.written).toEqual([]);
    expect(o.said).toEqual([]);
  });

  it('puts the words into the composer, later ones too, and sends nothing when released onto to-text', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('fix the');
    talk.release('text');
    expect(o.last()).toBeNull();
    expect(o.written).toEqual(['fix the']);
    const shows = o.shown.length;
    r.hears('fix the button');
    expect(o.written).toEqual(['fix the', 'fix the button']);
    expect(o.shown).toHaveLength(shows);
    r.ends();
    vi.advanceTimersByTime(FINISH_MS * 2);
    expect(o.sent).toEqual([]);
  });

  it.each([
    ['the microphone never came on, as when iOS asks for it the first time', false, t.micJustOn],
    ['the microphone was on and heard nothing', true, t.notHeard],
  ])('says why and sends nothing when released and %s', (_, micOn, message) => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    if (micOn) r.starts();
    r.hears('   ');
    talk.release('send');
    r.ends();
    expect(o.said).toEqual([message]);
    expect(o.sent).toEqual([]);
  });

  it.each(['no-speech', 'aborted'])('takes the recognizer ending with %s as hearing nothing, not as a failure', (error) => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('still here');
    r.ends(error);
    expect(o.failed).toEqual([]);
    expect(o.last()).not.toBeNull();
    talk.release('send');
    expect(o.sent).toEqual(['still here']);
  });

  it('closes the panel and reports a failure on any other recognizer error', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('half a');
    r.ends('network');
    expect(o.failed).toEqual(['network']);
    expect(o.last()).toBeNull();
    talk.release('send');
    vi.advanceTimersByTime(FINISH_MS * 2);
    expect(o.sent).toEqual([]);
  });

  it.each([undefined, 'no-speech', 'aborted'])(
    'closes the panel and says speech is unavailable when the recognizer ends with %s before the microphone came on',
    (error) => {
      const { r, recognize } = recognizer();
      const o = talkTo();
      const talk = startTalk(recognize, o.to)!;
      r.ends(error);
      expect(o.last()).toBeNull();
      expect([...o.said, ...o.failed]).toEqual([t.speechUnavailable]);
      talk.release('send');
      vi.advanceTimersByTime(FINISH_MS * 2);
      expect(o.said).toHaveLength(1);
      expect(o.sent).toEqual([]);
    },
  );

  it('says in words, not what the platform threw, that there is no recognizer, and gives no hold', () => {
    const o = talkTo();
    const talk = startTalk(() => {
      throw new Error('UnexpectedException: Speech is not allowed (at ExpoModulesCore/Promise.swift:56)');
    }, o.to);
    expect(talk).toBeNull();
    expect(o.last()).toBeNull();
    expect(o.said).toEqual([t.speechUnavailable]);
  });

  it('says speech is unavailable when the recognizer throws with no message', () => {
    const o = talkTo();
    expect(
      startTalk(() => {
        throw new Error('');
      }, o.to),
    ).toBeNull();
    expect(o.said).toEqual([t.speechUnavailable]);
  });

  it('stops listening quietly and then does nothing when dropped mid-hold', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('half');
    talk.drop();
    expect(r.aborts).toBe(1);
    expect(o.last()).toBeNull();
    const shows = o.shown.length;
    talk.drop();
    talk.move('text');
    talk.release('send');
    talk.release('text');
    r.hears('half a sentence');
    r.ends();
    vi.advanceTimersByTime(FINISH_MS * 2);
    expect(r.aborts).toBe(1);
    expect(r.stops).toBe(0);
    expect(o.shown).toHaveLength(shows);
    expect([o.sent, o.written, o.said, o.failed]).toEqual([[], [], [], []]);
  });

  it('ignores a second release or move once released', () => {
    const { r, recognize } = recognizer();
    const o = talkTo();
    const talk = startTalk(recognize, o.to)!;
    r.starts();
    r.hears('once');
    talk.release('send');
    talk.release('cancel');
    talk.move('text');
    talk.release('text');
    expect(r.stops).toBe(1);
    expect(r.aborts).toBe(0);
    r.ends();
    expect(o.sent).toEqual(['once']);
    expect(o.written).toEqual([]);
  });
});

// The codes Apple's recognizer (expo-speech-recognition) and the Web Speech API stop with.
const CODES = ['network', 'audio-capture', 'interrupted', 'busy', 'speech-timeout', 'language-not-supported', 'bad-grammar', 'client', 'unknown', 'something-new'];

describe('speechErrorText', () => {
  it.each(CODES)('says why recognition stopped with %s in words, never the code', (code) => {
    expect([...Object.values(t.speechErrors), t.speechLanguage, t.speechStopped]).toContain(speechErrorText(code));
  });

  it('names the reasons it knows and reads any other as stopped', () => {
    expect(speechErrorText('network')).toBe(t.speechErrors.network);
    expect(speechErrorText('language-not-supported')).toBe(t.speechLanguage);
    expect(speechErrorText('something-new')).toBe(t.speechStopped);
  });

  it('has every reason in both languages', () => {
    expect(Object.keys(dictionaries.zh.speechErrors).sort()).toEqual(Object.keys(dictionaries.en.speechErrors).sort());
  });
});
