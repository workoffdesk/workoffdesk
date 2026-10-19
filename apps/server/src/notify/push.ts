import webpush from 'web-push';
import type { Apns } from './apns.js';
import type { PushEvent } from '../agents/claude/hooks/status.js';
import type { ApnsDeviceRecord, PushSub, Store } from '../system/store.js';
import { seal, threadOf } from './seal.js';

const COOLDOWN = 30_000;
// The most of what Claude said a notification carries; the phone shows the first lines of it.
const SAID_MAX = 300;

// What Claude said, as a line of plain text: the marks of its markdown taken off, its start kept.
export function plainLine(said: string): string {
  const text = said
    .replace(/^\s*```.*$/gm, '')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > SAID_MAX ? `${chars.slice(0, SAID_MAX - 1).join('')}…` : text;
}

const TITLE_MAX = 80;

// An announcement's title as one short line, so no push service refuses it for its size.
export function plainTitle(title: string): string {
  return Array.from(title.replace(/[\s\p{Cc}]+/gu, ' ').trim()).slice(0, TITLE_MAX).join('').trimEnd();
}

type Send = (sub: PushSub, payload: string, opts: object) => Promise<unknown>;
// Posts to an App Store app's relay; resolves to the status it answered.
export type RelayPost = (url: string, body: string) => Promise<number>;

// The thread, tag and collapse id an announcement goes under, which no session has.
const ANNOUNCE = 'announce';

// What goes to one App device: the alert it is shown, the thread it is grouped under, and the payload for Apple.
// sessionId is what the phone opens when it is tapped.
type AppMessage = { thread: string; sessionId?: string; alert: (d: ApnsDeviceRecord) => object; payload: (alert: object) => object };

const RELAY_WAIT_MS = 10_000;
const relayFetch: RelayPost = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(RELAY_WAIT_MS) }).then((r) => r.status);

export class Pusher {
  private readonly send: Send;
  private readonly now: () => number;
  private readonly subject: string;
  private readonly apns?: Apns;
  private readonly relayPost: RelayPost;
  private readonly lastSent = new Map<string, number>();
  private readonly visible = new Map<string, Set<string>>();

  constructor(
    private readonly store: Store,
    opts: { send?: Send; now?: () => number; subject: string; apns?: Apns; relayPost?: RelayPost },
  ) {
    this.send = opts.send ?? ((sub, payload, o) => webpush.sendNotification(sub, payload, o));
    this.now = opts.now ?? Date.now;
    this.subject = opts.subject;
    this.apns = opts.apns;
    this.relayPost = opts.relayPost ?? relayFetch;
  }

  // Whether the iPhone app can be sent notifications from here.
  get toPhones(): boolean {
    return !!this.apns;
  }

  setVisible(sessionId: string, connId: string, isVisible: boolean): void {
    const conns = this.visible.get(sessionId) ?? new Set<string>();
    if (isVisible) conns.add(connId);
    else conns.delete(connId);
    if (conns.size) this.visible.set(sessionId, conns);
    else this.visible.delete(sessionId);
  }

  async notify(sessionId: string, title: string, event: PushEvent, said: string): Promise<void> {
    const { vapid, pushSubs, apnsDevices } = this.store.get();
    const browsers = vapid ? pushSubs : [];
    const phones = apnsDevices.filter((d) => (this.relayed(d) ? true : !!this.apns));
    if ((!browsers.length && !phones.length) || this.visible.has(sessionId)) return;
    const t = this.now();
    if (t - (this.lastSent.get(sessionId) ?? -Infinity) < COOLDOWN) return;
    this.lastSent.set(sessionId, t);
    const line = plainLine(said);
    await Promise.all([
      this.toBrowsers(browsers, { title, event, said: line, url: `/m/local/s/${sessionId}`, tag: sessionId }),
      this.toApp(phones, {
        thread: sessionId,
        sessionId,
        alert: (d) => alertOf(title, d.words[event], event, line),
        payload: (alert) => ({ aps: { alert, sound: 'default', 'thread-id': sessionId }, body: { sessionId } }),
      }),
    ]);
  }

  // A plain message to every registered device: no session, no cooldown, and not held back by a screen showing one.
  async announce(title: string, body: string): Promise<void> {
    const { vapid, pushSubs, apnsDevices } = this.store.get();
    const browsers = vapid ? pushSubs : [];
    const phones = apnsDevices.filter((d) => (this.relayed(d) ? true : !!this.apns));
    const said = plainLine(body);
    const headline = plainTitle(title);
    await Promise.all([
      this.toBrowsers(browsers, { title: headline, body: said, said, url: '/', tag: ANNOUNCE }),
      this.toApp(phones, {
        thread: ANNOUNCE,
        alert: () => ({ title: headline, body: said }),
        payload: (alert) => ({ aps: { alert, sound: 'default', 'thread-id': ANNOUNCE } }),
      }),
    ]);
  }

  private async toBrowsers(subs: PushSub[], message: object): Promise<void> {
    const vapid = this.store.get().vapid;
    if (!subs.length || !vapid) return;
    const payload = JSON.stringify(message);
    const opts = {
      vapidDetails: { subject: this.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 300,
      urgency: 'high',
    };
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await this.send(sub, payload, opts);
        } catch (e) {
          const status = (e as { statusCode?: number } | null)?.statusCode;
          if (status === 404 || status === 410) gone.push(sub.endpoint);
        }
      }),
    );
    if (gone.length) {
      this.store.update((s) => {
        s.pushSubs = s.pushSubs.filter((x) => !gone.includes(x.endpoint));
      });
    }
  }

  // An App Store app's device goes through its relay, unless this server is that relay; any other, to Apple
  // with this server's key.
  private relayed(d: ApnsDeviceRecord): boolean {
    return !!d.relay && this.apns?.relayTopic !== d.topic;
  }

  private async toApp(devices: ApnsDeviceRecord[], msg: AppMessage): Promise<void> {
    if (!devices.length) return;
    const results = await Promise.all(
      devices.map(async (d): Promise<{ token: string; host?: ApnsDeviceRecord['host']; gone: boolean }> => {
        const alert = msg.alert(d);
        if (this.relayed(d)) return { token: d.token, gone: await this.throughRelay(d, msg.thread, alert, msg.sessionId) };
        const { host, gone } = await this.apns!.send(d, msg.payload(alert), msg.thread);
        return { token: d.token, host, gone };
      }),
    );
    const gone = new Set(results.filter((r) => r.gone).map((r) => r.token));
    const learned = new Map(results.filter((r) => !r.gone && r.host).map((r) => [r.token, r.host!]));
    const known = new Map(devices.map((d) => [d.token, d.host]));
    if (!gone.size && [...learned].every(([token, host]) => known.get(token) === host)) return;
    this.store.update((s) => {
      s.apnsDevices = s.apnsDevices.filter((d) => !gone.has(d.token)).map((d) => (learned.has(d.token) ? { ...d, host: learned.get(d.token) } : d));
    });
  }

  // Whether the relay says the device is gone.
  private async throughRelay(d: ApnsDeviceRecord, thread: string, alert: object, sessionId?: string): Promise<boolean> {
    const { url, key } = d.relay!;
    const body = { token: d.token, topic: d.topic, sealed: seal(key, { alert, sessionId }), thread: threadOf(key, thread), hidden: d.words.hidden ?? '' };
    try {
      return (await this.relayPost(`${url}/api/push/relay`, JSON.stringify(body))) === 410;
    } catch {
      return false;
    }
  }
}

// The phone's words for the event say what happened, and what Claude said, what about. A finished turn's
// reply says by itself that the turn is over.
function alertOf(title: string, words: string, event: PushEvent, said: string) {
  if (!said) return { title, body: words };
  return event === 'waiting' ? { title, subtitle: words, body: said } : { title, body: said };
}
