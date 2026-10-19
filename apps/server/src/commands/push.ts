import { askPush } from '../sessions/control.js';
import { m } from '../system/messages.js';
import { homeDir, socketPath } from '../system/paths.js';
import { fail } from './common.js';

export type PushIO = { sock: string; fail(message: string): unknown };

const real = (): PushIO => ({ sock: socketPath(homeDir(), 'control.sock'), fail });

// A plain message to every phone and browser registered with the running service.
export async function push(args: string[], io: PushIO = real()) {
  const [title, body] = args;
  if (args.length !== 2 || !title || !body) return io.fail(m.cli.pushUsage);
  try {
    await askPush(io.sock, title, body);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return io.fail(code === 'ENOENT' || code === 'ECONNREFUSED' ? m.cli.notRunning : (e as Error).message);
  }
}
