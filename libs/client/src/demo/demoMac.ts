import { MACHINE, type ClaudeStatus, type SessionKind, type TermSession } from '../base/api';
import { CLOSE_GONE, type OpenSocket, type Socket, type SocketEvents } from '../base/platform';
import type { JournalRow, Message, Task } from '../journal/journalRows';
import type { ChatItem } from '../model/chat';
import { demoText, type DemoSessionText, type Step } from './content';

// The address of the Mac the demo simulates, which no real server has.
export const DEMO_SERVER = 'demo:';

const NOTHING_ON_SCREEN = { choices: null, panel: null };
const ESC = 0x1b;
const CTRL_C = 0x03;

type Sim = {
  session: TermSession;
  conv: string;
  v: number;
  rows: Map<string, JournalRow>;
  pos: number;
  // The steps under way and what stops them, a tool call among them still without its result.
  playing: { timer: ReturnType<typeof setTimeout>; open: string | null } | null;
  queue: Message[];
  messages: Map<string, Message>;
  lines: Set<SocketEvents>;
  // Played once, the first time its page is opened.
  onOpen: (() => void) | null;
  subagents: Map<string, { description: string; items: ChatItem[] }>;
};

const answer = (body: unknown, status = 200) => Promise.resolve(Response.json(body ?? {}, { status }));
const notInDemo = () => answer({ error: 'not in the demo', code: 'demo' }, 409);
const notFound = (error: string) => answer({ error }, 404);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A Mac the app can be tried on with none at hand (docs/design/2026-10-15-demo-mode.md): `fetch` and `open` in
// the shapes of the network's, answering as a Mac's workoffdesk does, from sessions held in memory and made up.
export function createDemoMac(o: { lang: 'en' | 'zh' }) {
  const text = demoText(o.lang);
  const epoch = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sims = new Map<string, Sim>();
  const listLines = new Set<SocketEvents>();
  let made = 0;
  let runs = 0;

  const say = (to: SocketEvents, msg: unknown) => to.message(JSON.stringify(msg));
  const listed = () => ({ type: 'sessions', machine: MACHINE, asOf: Date.now(), sessions: [...sims.values()].map((s) => s.session) });
  const heads = () => ({ type: 'heads', machine: MACHINE, epoch, heads: Object.fromEntries([...sims.values()].map((s) => [s.session.id, s.v])) });
  const tellList = () => {
    for (const l of listLines) {
      say(l, listed());
      say(l, heads());
    }
  };

  // Rows written together, at one new version, pushed to the session's lines as the Mac pushes them.
  const write = (s: Sim, rows: Omit<JournalRow, 'v'>[]) => {
    const from = s.v;
    s.v += 1;
    const written = rows.map((r) => ({ ...r, v: s.v }));
    for (const r of written) s.rows.set(`${r.t}:${r.key}`, r);
    for (const l of s.lines) say(l, { type: 'journal', from, v: s.v, rows: written });
    s.session.lastActivity = Date.now();
    tellList();
  };
  const state = (key: string, body: unknown): Omit<JournalRow, 'v'> => ({ t: 'state', key, body });
  const item = (s: Sim, i: ChatItem): Omit<JournalRow, 'v'> => {
    const at = 'at' in i || i.k === 'result' || i.k === 'task' || i.k === 'todos' || i.k === 'bg' ? {} : { at: new Date().toISOString() };
    return { t: 'item', key: `${s.conv}:${s.pos}`, body: { ...i, ...at, pos: s.pos++, conv: s.conv } };
  };
  const message = (m: Message): Omit<JournalRow, 'v'> => ({ t: 'message', key: m.id, body: m });
  const status = (s: Sim, now: ClaudeStatus) => {
    s.session.status = now;
    return [state('status', now), state('workingSince', now === 'working' ? Date.now() : null)];
  };

  const add = (kind: SessionKind, t: DemoSessionText, minutesAgo: number): Sim => {
    made += 1;
    const id = `demo${made}`;
    const conv = uuid(made);
    const s: Sim = {
      session: {
        id,
        title: t.title,
        kind,
        cwd: t.cwd,
        ...(kind === 'codex' ? { codexThreadId: conv } : { claudeSessionId: conv }),
        createdAt: Date.now() - minutesAgo * 60_000,
        lastActivity: Date.now() - minutesAgo * 60_000,
        status: 'idle',
      },
      conv,
      v: 0,
      rows: new Map(),
      pos: 0,
      playing: null,
      queue: [],
      messages: new Map(),
      lines: new Set(),
      onOpen: null,
      subagents: new Map(),
    };
    sims.set(id, s);
    const at = (n: number) => new Date(Date.now() - (minutesAgo * 60 - n * 20) * 1000).toISOString();
    write(s, [state('conv', { conv }), ...status(s, 'idle'), ...t.items.map((i, n) => item(s, i.k === 'user' || i.k === 'text' || i.k === 'tool' ? { ...i, at: at(n) } : i))]);
    s.session.lastActivity = Date.now() - minutesAgo * 60_000;
    s.session.lastReply = lastReply(t.items);
    return s;
  };
  const lastReply = (items: ChatItem[]) => items.findLast((i) => i.k === 'text')?.text.split('\n')[0] ?? null;

  // Claude doing steps one after another, its status working until they are done; a message waiting goes next.
  const play = (s: Sim, steps: Step[], tasks: string[] = [], before: Omit<JournalRow, 'v'>[] = []) => {
    const run = ++runs;
    const tasksAt = (done: number): Task[] => tasks.map((subject, n) => ({ subject, status: n < done ? 'completed' : n === done ? 'in_progress' : 'pending' }));
    write(s, [...before, ...status(s, 'working'), ...(tasks.length ? [state('tasks', tasksAt(0))] : [])]);
    const next = (n: number) => {
      const step = steps[n];
      if (!step) {
        s.playing = null;
        s.session.lastReply = lastReply(steps.flatMap((x) => (x.item ? [x.item] : [])));
        write(s, [state('live', { text: null }), ...status(s, 'idle')]);
        return answerNext(s);
      }
      s.playing = {
        open: s.playing?.open ?? null,
        timer: setTimeout(() => {
          const rows: Omit<JournalRow, 'v'>[] = [];
          let i = step.item;
          if (i && (i.k === 'tool' || i.k === 'result')) i = { ...i, id: `${i.id}-${run}` };
          if (i) rows.push(item(s, i));
          if (i?.k === 'tool') s.playing!.open = i.id;
          if (i?.k === 'result') s.playing!.open = null;
          if (step.live !== undefined) rows.push(state('live', { text: step.live }));
          if (step.tasksDone !== undefined) rows.push(state('tasks', tasksAt(step.tasksDone)));
          write(s, rows);
          next(n + 1);
        }, step.after),
      };
    };
    next(0);
  };

  // A message lands as the turn that starts Claude's answer.
  const take = (s: Sim, m: Message) => {
    const turn = item(s, { k: 'user', text: m.text });
    const landed: Message = { ...m, state: 'landed', ord: null, item: turn.key };
    s.messages.set(m.id, landed);
    play(s, text.reply(m.text), [], [turn, message(landed)]);
  };
  const answerNext = (s: Sim) => {
    const m = s.queue.shift();
    if (m) take(s, m);
  };

  // What Esc does to Claude: what it was doing stops, said so in the chat.
  const interrupt = (s: Sim) => {
    if (!s.playing) return;
    clearTimeout(s.playing.timer);
    const open = s.playing.open;
    s.playing = null;
    write(s, [
      ...(open ? [item(s, { k: 'result', id: open, text: '', error: false, stopped: true })] : []),
      item(s, { k: 'note', event: { e: 'interrupted' } }),
      state('live', { text: null }),
      ...status(s, 'idle'),
    ]);
    answerNext(s);
  };

  const sync = (s: Sim, at: string, v: number) => {
    const all = [...s.rows.values()];
    if (at !== epoch) return { epoch, v: s.v, rows: all, more: false, reset: true as const, older: null };
    return { epoch, v: s.v, rows: all.filter((r) => r.v > v), more: false };
  };

  const posted = (s: Sim, body: { text?: string; id?: string }) => {
    if (typeof body.text !== 'string' || typeof body.id !== 'string') return answer({ error: 'bad message' }, 400);
    const had = s.messages.get(body.id);
    if (had) return answer({ message: s.rows.get(`message:${had.id}`) ?? null });
    const busy = s.playing !== null || s.queue.length > 0;
    const m: Message = { id: body.id, text: body.text, sentAt: Date.now(), state: busy ? 'queued' : 'delivered', ord: busy ? s.queue.length + 1 : null, item: null };
    s.messages.set(m.id, m);
    write(s, [message(m)]);
    const row = s.rows.get(`message:${m.id}`);
    s.queue.push(m);
    if (!busy) setTimeout(() => answerNext(s), 300);
    return answer({ message: row });
  };

  const start = (body: { kind?: unknown; cwd?: unknown; title?: unknown }) => {
    if ((body.kind !== 'claude' && body.kind !== 'codex') || typeof body.cwd !== 'string' || !text.folders.includes(body.cwd)) return notInDemo();
    const title = typeof body.title === 'string' && body.title ? body.title : body.cwd.split('/').pop()!;
    return answer(add(body.kind, { title, cwd: body.cwd, items: [] }, 0).session, 201);
  };
  const end = (s: Sim) => {
    if (s.playing) clearTimeout(s.playing.timer);
    sims.delete(s.session.id);
    for (const l of s.lines) l.close(CLOSE_GONE);
    s.lines.clear();
    tellList();
    return answer({});
  };

  const done = add('claude', text.done, 25);
  done.subagents.set(text.done.subagent.id, { description: text.done.subagent.description, items: text.done.subagent.items });
  const busy = add('claude', text.busy, 3);
  write(busy, [...status(busy, 'working'), state('tasks', text.busy.tasks.map((subject, n) => ({ subject, status: n ? 'pending' : 'in_progress' })))]);
  busy.onOpen = () => play(busy, text.busy.steps, text.busy.tasks);
  add('codex', text.codex, 60 * 26);

  const byClaude = (sid: string) => [...sims.values()].find((s) => s.conv === sid) ?? null;
  const opened = (s: Sim) => {
    const first = s.onOpen;
    s.onOpen = null;
    first?.();
  };
  // A chat page's turns of a transcript, by place, as the chat routes page them.
  const chatPage = (sid: string, items: ChatItem[], q: URLSearchParams) => {
    const from = q.get('sid') === sid ? Math.min(Number(q.get('from') ?? 0) || 0, items.length) : 0;
    return answer({ sid, items: items.slice(from), from, next: items.length, skipped: false });
  };
  const itemsOf = (s: Sim) =>
    [...s.rows.values()]
      .filter((r) => r.t === 'item')
      .map((r) => r.body as ChatItem & { pos: number })
      .sort((a, b) => a.pos - b.pos);

  async function fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const at = new URL(url.slice(DEMO_SERVER.length), 'http://demo');
    const path = at.pathname;
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const sessions = `/api/m/${MACHINE}/sessions`;

    if (path === '/api/events/now' && method === 'GET') return answer(listed());
    if (path === sessions && method === 'GET') return answer([...sims.values()].map((s) => s.session));
    if (path === sessions && method === 'POST') return start(body);
    if (path === '/api/claude/projects') return answer(text.folders);
    if (path === '/api/recent' || path === '/api/claude/recent' || path === '/api/auth/logins') return answer([]);
    if (['/api/push/apns', '/api/slow', '/api/chat-end', '/api/auth/logout'].includes(path)) return answer({});

    const sub = path.match(/^\/api\/claude\/sessions\/([^/]+)\/agents\/([^/]+)(\/chat)?$/);
    if (sub) {
      const agent = byClaude(sub[1])?.subagents.get(decodeURIComponent(sub[2]));
      if (!agent) return notFound('no such sub-agent');
      return sub[3] ? chatPage(decodeURIComponent(sub[2]), agent.items, at.searchParams) : answer({ description: agent.description });
    }
    const conversation = path.match(/^\/api\/claude\/sessions\/([^/]+)\/chat$/);
    if (conversation) {
      const s = byClaude(conversation[1]);
      return s ? chatPage(s.conv, itemsOf(s), at.searchParams) : notFound('no such conversation');
    }

    const one = path.match(new RegExp(`^${sessions}/([^/]+)(/.*)?$`));
    const s = one && sims.get(one[1]);
    if (one && !s) return notFound('no such session');
    if (s) {
      const rest = one![2] ?? '';
      if (rest === '' && method === 'DELETE') return end(s);
      if (rest === '' && method === 'PATCH' && typeof body.title === 'string') {
        s.session.title = body.title;
        tellList();
        return answer({});
      }
      if (rest === '/pin') {
        if (method === 'PUT') s.session.pinned = Date.now();
        else delete s.session.pinned;
        tellList();
        return answer({});
      }
      if (rest === '/journal') {
        opened(s);
        return answer(sync(s, at.searchParams.get('epoch') ?? '', Number(at.searchParams.get('v') ?? 0)));
      }
      if (rest === '/journal/items') return answer({ rows: [], older: null });
      if (rest === '/messages' && method === 'POST') return posted(s, body);
      if (rest === '/keys' && method === 'POST') {
        const keys = typeof body.keys === 'string' ? body.keys : '';
        if (keys.includes('\x1b') || keys.includes('\x03')) interrupt(s);
        return answer({ screen: NOTHING_ON_SCREEN });
      }
      if (rest === '/choices' && method === 'GET') return answer(NOTHING_ON_SCREEN);
      if (rest === '/models') return answer({ models: [] });
      if (rest === '/commands') return answer({ commands: [] });
      if (rest === '/files') return answer({ files: [] });
    }
    return notInDemo();
  }

  // A line the demo's Mac answers on: the list's, or a session's.
  const open: OpenSocket = (path, on) => {
    let up = true;
    const sessionLine = path.match(new RegExp(`^/api/m/${MACHINE}/sessions/([^/]+)/ws$`));
    const s = sessionLine ? sims.get(sessionLine[1]) : null;
    const lines = s ? s.lines : sessionLine ? null : path === '/api/events' ? listLines : null;
    const socket: Socket = {
      isOpen: () => up,
      send(data) {
        if (!up || !s) return;
        if (typeof data !== 'string') {
          if (data.includes(ESC) || data.includes(CTRL_C)) interrupt(s);
          return;
        }
        const msg = JSON.parse(data) as { type?: string; epoch?: string; v?: number };
        if (msg.type !== 'journal') return;
        const caught = sync(s, msg.epoch ?? '', msg.v ?? 0);
        say(on, { type: 'journal', from: 'reset' in caught ? 0 : (msg.v ?? 0), ...caught });
      },
      close() {
        if (!up) return;
        up = false;
        lines?.delete(on);
        setTimeout(() => on.close(1000), 0);
      },
    };
    setTimeout(() => {
      if (!up) return;
      if (!lines) {
        up = false;
        return on.close(sessionLine ? CLOSE_GONE : 1006);
      }
      lines.add(on);
      on.open();
      if (lines === listLines) {
        say(on, listed());
        say(on, heads());
      }
      if (s) {
        opened(s);
        say(on, { type: 'screen', screen: NOTHING_ON_SCREEN });
      }
    }, 0);
    return socket;
  };

  return { fetch, open };
}
