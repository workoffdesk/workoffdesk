import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppDeps } from '../app.js';
import type { Guard } from '../auth/guard.js';
import type { LoginSessions } from '../auth/sessions.js';
import type { EventHub } from '../../sessions/events.js';
import type { LocalMachine } from '../../sessions/machine.js';
import type { Login } from '../../system/store.js';

// What every group of routes is handed: the app's dependencies and the pieces of login and socket
// handling they share.
export type AppContext = {
  deps: AppDeps;
  guard: Guard;
  logins: LoginSessions;
  hub: EventHub;
  secure: boolean;
  now: () => number;
  audit: (req: FastifyRequest, method: Login['method'], ok: boolean) => void;
  // A new login's id, for the caller to hand over: in a cookie (startLogin), or as a token for the app.
  createLogin: (req: FastifyRequest, method: Login['method']) => string;
  startLogin: (req: FastifyRequest, reply: FastifyReply, method: Login['method']) => void;
  // Takes a websocket in if its login is good; it is closed when that login ends.
  admit: (socket: WebSocket, req: FastifyRequest) => boolean;
  dropRevokedSockets: () => void;
  // The machine the URL names, or null with the 404 already sent.
  machineOr404: (req: FastifyRequest<{ Params: { machine: string } }>, reply: FastifyReply) => LocalMachine | null;
};

export const PUBLIC = { config: { public: true } };

export type RouteModule = (app: FastifyInstance, ctx: AppContext) => void | Promise<void>;
