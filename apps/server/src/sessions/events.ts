import type { WebSocket } from 'ws';
import type { LocalMachine, TermSession } from './machine.js';

// What Claude said last in a session, for the list; null for a shell or before Claude has said anything.
export type LastReply = (s: TermSession) => Promise<string | null>;

export class EventHub {
  private readonly clients = new Set<WebSocket>();
  private pending: NodeJS.Timeout | null = null;
  private pendingHeads: NodeJS.Timeout | null = null;

  constructor(
    private readonly machine: LocalMachine,
    private readonly lastReply: LastReply = async () => null,
  ) {
    machine.onChange(() => this.schedule());
    machine.journal.onHead(() => this.scheduleHeads());
  }

  async add(socket: WebSocket): Promise<void> {
    this.clients.add(socket);
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on('close', () => {
      clearInterval(ping);
      this.clients.delete(socket);
    });
    const snapshot = await this.snapshot();
    if (snapshot) socket.send(JSON.stringify(snapshot));
    socket.send(JSON.stringify(this.heads()));
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = setTimeout(async () => {
      this.pending = null;
      if (!this.clients.size) return;
      const snapshot = await this.snapshot();
      if (!snapshot) return;
      const msg = JSON.stringify(snapshot);
      for (const c of this.clients) if (c.readyState === c.OPEN) c.send(msg);
    }, 50);
  }

  // Each session's journal version, sent on its own: it changes with every line Claude writes, and the
  // list is costly to read.
  private scheduleHeads(): void {
    if (this.pendingHeads) return;
    this.pendingHeads = setTimeout(() => {
      this.pendingHeads = null;
      const msg = JSON.stringify(this.heads());
      for (const c of this.clients) if (c.readyState === c.OPEN) c.send(msg);
    }, 50);
  }

  private heads() {
    return { type: 'heads', machine: this.machine.id, epoch: this.machine.journal.epoch, heads: this.machine.journal.heads() };
  }

  // Null when tmux does not answer: the next change, or the machine's watch, brings a list that holds.
  // asOf: when it was read, so a client can tell an answer about a message (dated by its `at`) the list
  // already accounts for from one it does not. Also asked for on its own, by a client whose socket does
  // not get through.
  async snapshot() {
    const asOf = Date.now();
    const sessions = await this.machine.listSessions().catch(() => null);
    if (!sessions) return null;
    const replies = await Promise.all(sessions.map((s) => this.lastReply(s).catch(() => null)));
    return { type: 'sessions', machine: this.machine.id, asOf, sessions: sessions.map((s, i) => ({ ...s, lastReply: replies[i] })) };
  }

  close(): void {
    if (this.pending) clearTimeout(this.pending);
    if (this.pendingHeads) clearTimeout(this.pendingHeads);
    for (const c of this.clients) c.close(1001);
  }
}
