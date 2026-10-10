import { readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { writeJsonAtomic } from '../../../system/paths.js';
import type { HeldHook, PermissionPayload } from './asks.js';
import { HOOK_EVENTS } from './status.js';

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const hookCommand = (sockPath: string) =>
  `curl -s -o /dev/null --max-time 2 --unix-socket ${shq(sockPath)} ` +
  `-H "x-workoffdesk-session: $WORKOFFDESK_SESSION" --data-binary @- http://localhost/hook || true`;

// How long a permission prompt's hook waits for the phone. The dialog is on the Mac's screen meanwhile.
const PERMISSION_HOLD_S = 3600;

// Prints what the server answers, which is the hook's decision; nothing when it cannot be reached.
const permissionCommand = (sockPath: string) =>
  `curl -s --max-time ${PERMISSION_HOLD_S} --unix-socket ${shq(sockPath)} ` +
  `-H "x-workoffdesk-session: $WORKOFFDESK_SESSION" --data-binary @- http://localhost/permission || true`;

const QUOTED = /^'(?:[^']|'\\'')*'$/;
const OWN = [hookCommand, permissionCommand].map((make) => make('\0').split(shq('\0')));

// Whether a hook command is one workoffdesk installs, for a service home anywhere.
export function isOwnHookCommand(command: string): boolean {
  return OWN.some(([head, tail]) => command.startsWith(head) && command.endsWith(tail) && QUOTED.test(command.slice(head.length, command.length - tail.length)));
}

const statusPost = (sockPath: string) =>
  `curl -s -o /dev/null --max-time 2 --unix-socket ${shq(sockPath)} ` +
  `-H "x-workoffdesk-session: $WORKOFFDESK_SESSION" --data-binary @- http://localhost/status`;

export type StatusLine = { type: 'command'; command: string; padding?: number };

// The status line the user set for Claude Code themselves, which keeps drawing the terminal's.
export function userStatusLine(settingsPath: string): StatusLine | undefined {
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as { statusLine?: Partial<StatusLine> };
    const l = s.statusLine;
    if (l?.type !== 'command' || typeof l.command !== 'string' || !l.command) return undefined;
    return typeof l.padding === 'number' ? { type: 'command', command: l.command, padding: l.padding } : { type: 'command', command: l.command };
  } catch {
    return undefined;
  }
}

// What the status line is given goes to workoffdesk too, and the user's own status line still draws it.
export function statusLineCommand(sockPath: string, own?: string): string {
  const post = statusPost(sockPath);
  if (!own) return `${post} >/dev/null 2>&1 || true`;
  return `input=$(cat); { printf '%s' "$input" | ${post} >/dev/null 2>&1 & } ; printf '%s' "$input" | { ${own}
}`;
}

export function writeClaudeSettings(path: string, sockPath: string, own?: StatusLine): void {
  const command = hookCommand(sockPath);
  const hooks = {
    ...Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]])),
    PermissionRequest: [{ hooks: [{ type: 'command', command: permissionCommand(sockPath), timeout: PERMISSION_HOLD_S }] }],
  };
  const statusLine: StatusLine = { type: 'command', command: statusLineCommand(sockPath, own?.command) };
  if (own?.padding !== undefined) statusLine.padding = own.padding;
  // Agent view moves a conversation out of its window, on quitting or by /background, into a session the
  // phone cannot follow; what is typed afterwards starts new ones.
  writeJsonAtomic(path, { hooks, statusLine, disableAgentView: true });
}

const MAX_BODY = 1 << 20;

// What a Claude Code hook posts; only these fields are read, and each may be of any type.
export type HookPayload = {
  hook_event_name?: unknown;
  session_id?: unknown;
  notification_type?: unknown;
  trigger?: unknown;
  transcript_path?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  last_assistant_message?: unknown;
  message?: unknown;
};

export async function startHookServer(
  sockPath: string,
  onEvent: (termId: string, payload: HookPayload) => void,
  onStatus: (termId: string, payload: unknown) => void = () => {},
  // A permission prompt, held open until `hook` is answered.
  onPermission: (termId: string, payload: PermissionPayload, hook: HeldHook) => void = (_id, _p, hook) => hook.reply(null),
): Promise<Server> {
  const server = createServer((req, res) => {
    const termId = req.headers['x-workoffdesk-session'];
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      const held = req.url === '/permission';
      if (!held) res.end();
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        payload = null;
      }
      if (typeof termId !== 'string' || !termId || !payload || typeof payload !== 'object') {
        if (held) res.end();
        return;
      }
      if (held) {
        onPermission(termId, payload, {
          reply: (output) => res.writableEnded || res.end(output ? JSON.stringify(output) : ''),
          onGone: (cb) => res.on('close', () => res.writableEnded || cb()),
        });
      } else if (req.url === '/status') onStatus(termId, payload);
      else onEvent(termId, payload);
    });
  });
  return listenOwnerOnly(server, sockPath);
}

// The umask makes the socket owner-only from the moment it exists.
export async function listenOwnerOnly(server: Server, sockPath: string): Promise<Server> {
  rmSync(sockPath, { force: true });
  const oldMask = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(sockPath, () => resolve());
    });
  } finally {
    process.umask(oldMask);
  }
  return server;
}
