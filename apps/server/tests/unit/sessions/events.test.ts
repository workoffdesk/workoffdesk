import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { EventHub } from '../../../src/sessions/events.js';
import { Journal } from '../../../src/journal/index.js';
import type { Machine } from '../../../src/sessions/machine.js';

const sent: string[] = [];
const socket = { OPEN: 1, readyState: 1, send: (m: string) => sent.push(m), on: () => {}, ping: () => {}, close: () => {} } as unknown as WebSocket;

// A machine whose tmux fails to answer, as when the tmux server goes away under a list.
function failingMachine() {
  let changed = () => {};
  let fail = true;
  const machine = {
    id: 'local',
    onChange: (cb: () => void) => ((changed = cb), () => {}),
    listSessions: async () => {
      if (fail) throw new Error('server exited unexpectedly');
      return [];
    },
    journal: new Journal({ file: ':memory:', log: () => {} }),
  } as unknown as Machine;
  return { machine, change: () => changed(), failing: (f: boolean) => (fail = f) };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);
process.on('unhandledRejection', onUnhandled);
afterEach(() => {
  sent.length = 0;
  unhandled.length = 0;
});
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('EventHub', () => {
  it('lives through a list that fails for a page joining, and sends it the next one', async () => {
    const m = failingMachine();
    const hub = new EventHub(m.machine);
    await expect(hub.add(socket)).resolves.toBeUndefined();
    m.failing(false);
    m.change();
    await settle();
    expect(unhandled).toEqual([]);
    // The journal's heads go to a joining page whether or not the list could be read.
    expect(sent.map((s) => JSON.parse(s).type)).toEqual(['heads', 'sessions']);
    hub.close();
  });

  it('lives through a list that fails for a change, and sends the next one', async () => {
    const m = failingMachine();
    m.failing(false);
    const hub = new EventHub(m.machine);
    await hub.add(socket);
    const types = () => sent.map((s) => JSON.parse(s).type);
    expect(types(), 'precondition: the joining page got the list').toEqual(['sessions', 'heads']);
    m.failing(true);
    m.change();
    await settle();
    expect(unhandled).toEqual([]);
    m.failing(false);
    m.change();
    await settle();
    expect(types()).toEqual(['sessions', 'heads', 'sessions']);
    hub.close();
  });

  it.each([
    ['when the conversation last had anything in it', 5_000, 5_000],
    ['when tmux last saw it, for one with nothing in a conversation', null, 1_000],
  ])('dates a session by %s', async (_, at, shown) => {
    const machine = {
      id: 'local',
      onChange: () => () => {},
      listSessions: async () => [{ id: 's1', kind: 'claude', lastActivity: 1_000 }],
      journal: new Journal({ file: ':memory:', log: () => {} }),
    } as unknown as Machine;
    const hub = new EventHub(machine, async () => ({ reply: '好了', at }));
    expect((await hub.snapshot())?.sessions).toMatchObject([{ id: 's1', lastActivity: shown, lastReply: '好了' }]);
    hub.close();
  });
});
