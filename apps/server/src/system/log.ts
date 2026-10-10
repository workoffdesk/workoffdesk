import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import pino, { type Logger } from 'pino';

export const REDACT = ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'res.headers["set-cookie"]'];

// A log file that is moved aside to .1 when it is full, the older ones moving up to .keep and then gone.
// Writes are synchronous: the lines are few and short, and none is lost when the process exits.
export class RotatingFile {
  private size: number;
  private readonly maxBytes: number;
  private readonly keep: number;

  constructor(
    private readonly path: string,
    o: { maxBytes?: number; keep?: number } = {},
  ) {
    this.maxBytes = o.maxBytes ?? 10 * 1024 * 1024;
    this.keep = o.keep ?? 3;
    mkdirSync(dirname(path), { recursive: true });
    this.size = existsSync(path) ? statSync(path).size : 0;
  }

  write(chunk: string): boolean {
    const bytes = Buffer.byteLength(chunk);
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.path, chunk, { mode: 0o600 });
    this.size += bytes;
    return true;
  }

  private rotate(): void {
    rmSync(`${this.path}.${this.keep}`, { force: true });
    for (let n = this.keep - 1; n >= 1; n--) {
      if (existsSync(`${this.path}.${n}`)) renameSync(`${this.path}.${n}`, `${this.path}.${n + 1}`);
    }
    renameSync(this.path, `${this.path}.1`);
    this.size = 0;
  }
}

export function createLogger(o: { file?: string; level?: string } = {}): Logger {
  const destination = o.file ? new RotatingFile(o.file) : process.stdout;
  return pino({ level: o.level ?? 'info', redact: { paths: REDACT, censor: '[redacted]' } }, destination);
}
