import { spawn } from 'node:child_process';

const ASK_MS = 15_000;
const KEPT_MS = 5 * 60_000;

// What Claude Code tells a program that drives it, before any turn: what its prompt takes (`commands`), the
// models this account can pick (`models`), and more. Fields may be missing or of any type.
export type Initialized = { commands?: unknown; models?: unknown };

const told = new Map<string, { at: number; answer: Promise<Initialized> }>();

// Claude Code's answer in `cwd`, kept a while: it changes only with its settings, plugins and account.
export function initialized(bin: string, cwd: string): Promise<Initialized> {
  const key = `${bin}\n${cwd}`;
  const kept = told.get(key);
  if (kept && Date.now() - kept.at < KEPT_MS) return kept.answer;
  const answer = askClaude(bin, cwd);
  told.set(key, { at: Date.now(), answer });
  answer.catch(() => told.get(key)?.answer === answer && told.delete(key));
  return answer;
}

// Asked as a program asks it (`-p`, stream-json) before any turn, so nothing goes to the model; without hooks
// or a transcript, so it leaves no trace.
function askClaude(bin: string, cwd: string): Promise<Initialized> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--settings', JSON.stringify({ disableAllHooks: true })],
      { cwd, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let done = false;
    const finish = (error: Error | null, answer: Initialized = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(answer);
    };
    const timer = setTimeout(() => finish(new Error('claude did not answer initialize')), ASK_MS);
    child.on('error', finish);
    child.on('exit', () => finish(new Error('claude ended before answering initialize')));
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      for (let end = out.indexOf('\n'); end >= 0; end = out.indexOf('\n')) {
        const line = out.slice(0, end);
        out = out.slice(end + 1);
        let msg: { type?: unknown; response?: { response?: unknown } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.type !== 'control_response') continue;
        const answer = msg.response?.response;
        return answer && typeof answer === 'object' ? finish(null, answer) : finish(new Error('claude answered initialize with nothing'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize' } })}\n`);
  });
}
