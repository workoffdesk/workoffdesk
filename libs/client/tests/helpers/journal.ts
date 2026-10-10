import type { Visibility } from '../../src/base/platform';
import { createJournals } from '../../src/journal/journal';
import type { JournalRow, JournalStore, Message } from '../../src/journal/journalRows';
import { fakeApi, fakeVisibility, flush } from './fakes';

// Talking to a fake Mac about a session's journal.
let n = 0;
export const base = (id: string) => `/api/m/local/sessions/${id}`;
export const ask = (id: string, epoch = '', v = 0) => `GET ${base(id)}/journal?epoch=${epoch}&v=${v}`;
export const POST = (id: string) => `POST ${base(id)}/messages`;

export const item = (key: string, pos: number, conv = 'c1'): JournalRow => ({ t: 'item', key, v: pos, body: { k: 'user', text: `turn ${pos}`, pos, conv } });
export const state = (key: string, body: unknown, v = 1): JournalRow => ({ t: 'state', key, v, body });
export const message = (m: Partial<Message> & { id: string }, v = 1): JournalRow => ({
  t: 'message',
  key: m.id,
  v,
  body: { text: 'hi', sentAt: 1, state: 'delivered', ord: null, item: null, ...m },
});
export const sync = (v: number, rows: JournalRow[] = [], o: { epoch?: string; more?: boolean; reset?: true; older?: number | null } = {}) => ({
  epoch: 'e1',
  v,
  rows,
  more: false,
  ...o,
});

export function memoryStore(kept: Awaited<ReturnType<JournalStore['load']>> = null) {
  const did: string[] = [];
  const store: JournalStore = {
    load: async () => kept,
    write: (id, at, rows, reset) => void did.push(`write ${at.epoch} ${at.v} ${at.older} ${rows.map((r) => r.key).join(',')}${reset ? ' reset' : ''}`),
    remove: (id, key) => void did.push(`remove ${key}`),
    forget: async () => void did.push('forget'),
  };
  return { store, did };
}

export const setup = (o: { store?: JournalStore; visible?: boolean } = {}) => {
  const api = fakeApi();
  const visibility = fakeVisibility(o.visible ?? true);
  let q = 0;
  const made = createJournals({ api: api.api, newId: () => `q${++q}`, store: o.store });
  // Followed from a page in front while `visibility` says so, unless another page is given.
  const journals = { ...made, follow: (id: string, page: Visibility = visibility) => made.follow(id, page) };
  const id = `s${++n}`;
  return { api, visibility, journals, id, view: () => journals.view(id) };
};
// Following, with the Mac's first answer given.
export const following = async (rows: JournalRow[] = [], v = 3, o: Parameters<typeof setup>[0] = {}) => {
  const t = setup(o);
  const stop = t.journals.follow(t.id);
  await flush();
  await t.api.answer(ask(t.id), sync(v, rows));
  return { ...t, stop };
};
