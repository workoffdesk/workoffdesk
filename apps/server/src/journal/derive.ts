import type { ChatItem } from '../agents/claude/transcript/chat.js';

// What a session's page shows that is worked out from its conversation as a whole, not from one turn of it.
// The same rules the clients had (libs/client/src/model/chat.ts), on every item instead of the page held.

// Claude's task list: TodoWrite gives the whole list, TaskCreate and TaskUpdate one task each.
export type Task = { subject: string; status: string };
export function taskList(items: ChatItem[]): Task[] {
  let tasks = new Map<string, Task>();
  for (const i of items) {
    if (i.k === 'todos') tasks = new Map(i.items.map((t, n) => [`todo-${n}`, t]));
    if (i.k !== 'task') continue;
    if (i.status === 'deleted') {
      tasks.delete(i.id);
      continue;
    }
    const was = tasks.get(i.id);
    const subject = i.subject ?? was?.subject;
    if (subject) tasks.set(i.id, { subject, status: i.status ?? was?.status ?? 'pending' });
  }
  return [...tasks.values()];
}

// The commands Claude still runs in the background, named by the tool call that started each.
export type Background = { id: string; label: string };
export function backgroundRunning(items: ChatItem[]): Background[] {
  const tools = new Map<string, string>();
  const running = new Map<string, Background>();
  for (const i of items) {
    if (i.k === 'tool') tools.set(i.id, i.summary);
    if (i.k !== 'bg') continue;
    if (i.status === 'running') running.set(i.id, { id: i.id, label: (i.tool && tools.get(i.tool)) || i.id });
    else running.delete(i.id);
  }
  return [...running.values()];
}

// How much of what Claude is writing is compared with what the transcript already has.
const LIVE_PROBE = 40;
// The screen shows Markdown drawn, the transcript has it written: both are compared without its marks.
const flat = (s: string) => s.replace(/[\s*_`#>~|-]+/g, '');

// The reply Claude is writing, unless the transcript has it already among the items since the last
// message to Claude (then the reply shows, and the preview would be a second copy).
export function liveShown(live: string | null, items: ChatItem[]): string | null {
  if (!live) return null;
  const probe = flat(live).slice(0, LIVE_PROBE);
  for (let i = items.length - 1; i >= 0 && items[i].k !== 'user'; i--) {
    const t = items[i];
    if (t.k === 'text' && flat(t.text).includes(probe)) return null;
  }
  return live;
}
