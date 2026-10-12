import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileAtomic } from './paths.js';

// panePid: the process its pane started with, the command the session was made with.
export type TmuxSessionInfo = { name: string; created: number; activity: number; attached: number; panePid?: number };

export const TMUX_CONF = `# Managed by workoffdesk. Edits are overwritten on start.
set -g mouse on
set -g history-limit 50000
set -sg escape-time 0
set -g status off
setw -g window-size latest
set -g set-titles on
set -g default-terminal xterm-256color
set -g focus-events on
`;

export function writeTmuxConf(path: string): void {
  writeFileAtomic(path, TMUX_CONF);
}

// The server also exits on its own once its last session ends, while a command is talking to it.
const NOT_RUNNING = /no server running|error connecting|No such file or directory|server exited unexpectedly/;
const NO_SESSION = /can't find session|session not found/;
const stderrOf = (e: unknown) => String((e as { stderr?: unknown } | null)?.stderr ?? '');
// Long enough for a loaded Mac; a client still waiting then is killed rather than left behind.
const TIMEOUT_MS = 10_000;

// A command tmux did not answer in time. Its server may still carry it out, so a paste may have gone in.
export class TmuxTimeout extends Error {
  readonly mayHaveRun = true;
  constructor(command: string | undefined) {
    super(`tmux ${command ?? ''} did not answer in time`);
  }
}

export class Tmux {
  readonly bin: string;
  private readonly base: string[];
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(opts: { socket: string; conf: string; bin?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
    this.bin = opts.bin ?? 'tmux';
    this.base = ['-L', opts.socket, '-f', opts.conf];
    this.baseEnv = opts.env ?? process.env;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  // tmux escapes every non-ASCII byte, tabs in -F output included, unless the
  // locale says UTF-8; launchd starts processes with no locale at all.
  env(): Record<string, string> {
    const env = { ...this.baseEnv } as Record<string, string>;
    delete env.TMUX;
    if (!/utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) {
      delete env.LC_ALL;
      env.LC_CTYPE = 'en_US.UTF-8';
    }
    return env;
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let late = false;
      const child = execFile(this.bin, [...this.base, ...args], { env: this.env(), maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        clearTimeout(deadline);
        if (late) reject(new TmuxTimeout(args[0]));
        else if (err) reject(Object.assign(err, { stderr: String(stderr) }));
        else resolve(String(stdout));
      });
      const deadline = setTimeout(() => {
        late = true;
        child.kill('SIGKILL');
      }, this.timeoutMs);
    });
  }

  async newSession(
    name: string,
    opts: { cwd: string; command?: string; env: Record<string, string>; size?: { cols: number; rows: number } },
  ): Promise<void> {
    const envArgs = Object.entries(opts.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const { cols, rows } = opts.size ?? { cols: 200, rows: 50 };
    await this.run([
      'new-session', '-d', '-s', name, '-c', opts.cwd, '-x', String(cols), '-y', String(rows),
      ...envArgs,
      ...(opts.command ? [opts.command] : []),
    ]);
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    let out: string;
    try {
      out = await this.run([
        'list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_activity}\t#{session_attached}\t#{pane_pid}',
      ]);
    } catch (e) {
      if (NOT_RUNNING.test(stderrOf(e))) return [];
      throw e;
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, created, activity, attached, pane] = line.split('\t');
        return { name, created: +created * 1000, activity: +activity * 1000, attached: +attached, panePid: Number(pane) || undefined };
      });
  }

  // The process the session's pane runs; undefined when the session is gone.
  async panePid(name: string): Promise<number | undefined> {
    try {
      return Number(await this.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_pid}'])) || undefined;
    } catch (e) {
      if (NOT_RUNNING.test(stderrOf(e)) || NO_SESSION.test(stderrOf(e))) return undefined;
      throw e;
    }
  }

  // Ends what the session's pane runs and starts `command` there instead, in the same session.
  async respawnPane(name: string, opts: { cwd: string; command: string; env: Record<string, string> }): Promise<void> {
    const envArgs = Object.entries(opts.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    await this.run(['respawn-pane', '-k', '-t', `=${name}:`, '-c', opts.cwd, ...envArgs, opts.command]);
  }

  async hasSession(name: string): Promise<boolean> {
    return (await this.listSessions()).some((s) => s.name === name);
  }

  async killSession(name: string): Promise<void> {
    try {
      await this.run(['kill-session', '-t', `=${name}`]);
    } catch (e) {
      if (!NOT_RUNNING.test(stderrOf(e)) && !NO_SESSION.test(stderrOf(e))) throw e;
    }
  }

  async sendKeys(name: string, text: string): Promise<void> {
    await this.run(['send-keys', '-t', `=${name}:`, '-l', text]);
    await this.run(['send-keys', '-t', `=${name}:`, 'Enter']);
  }

  // One tmux command, so nothing can slip in between the check and the cancel.
  async leaveCopyMode(name: string): Promise<void> {
    await this.run(['if-shell', '-F', '-t', `=${name}:`, '#{pane_in_mode}', `send-keys -t =${name}: -X cancel`]);
  }

  async capture(name: string, lines: number): Promise<string> {
    return this.run(['capture-pane', '-p', '-e', '-J', '-t', `=${name}:`, '-S', `-${lines}`]);
  }

  // The screen as it is now, as plain text, without the scrollback.
  async screen(name: string): Promise<string> {
    return this.run(['capture-pane', '-p', '-t', `=${name}:`]);
  }

  // The screen as plain text and up to `lines` of the scrollback above it.
  async screenWithHistory(name: string, lines: number): Promise<string> {
    return this.run(['capture-pane', '-p', '-t', `=${name}:`, '-S', `-${lines}`]);
  }

  // The screen as plain text with each wrapped line joined back into one.
  async screenJoined(name: string): Promise<string> {
    return this.run(['capture-pane', '-p', '-J', '-t', `=${name}:`]);
  }

  // The screen with its colours and dimming as escape sequences.
  async screenStyled(name: string): Promise<string> {
    return this.run(['capture-pane', '-p', '-e', '-t', `=${name}:`]);
  }

  // The screen as `screen` does, and the scrollback lines just above it, from one capture.
  async screenAndAbove(name: string, lines: number): Promise<{ screen: string; above: string }> {
    const [text, height] = await Promise.all([
      this.run(['capture-pane', '-p', '-t', `=${name}:`, '-S', `-${lines}`]),
      this.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_height}']),
    ]);
    const all = text.replace(/\n$/, '').split('\n');
    const rows = Number(height.trim());
    return { above: all.slice(0, -rows).join('\n'), screen: `${all.slice(-rows).join('\n')}\n` };
  }

  // Text as a terminal pastes it, bracketed for a program that asked for that, then Enter as a key.
  async paste(name: string, text: string): Promise<void> {
    const buffer = `workoffdesk-${randomBytes(6).toString('hex')}`;
    const target = `=${name}:`;
    await this.run(['set-buffer', '-b', buffer, '--', text, ';', 'paste-buffer', '-p', '-r', '-d', '-b', buffer, '-t', target, ';', 'send-keys', '-t', target, 'Enter']);
  }

  async sendRaw(name: string, keys: string): Promise<void> {
    await this.run(['send-keys', '-t', `=${name}:`, '-l', '--', keys]);
  }

  async alternateOn(name: string): Promise<boolean> {
    return (await this.run(['display-message', '-p', '-t', `=${name}:`, '#{alternate_on}'])).trim() === '1';
  }

  // Resizing makes the window's size manual; it is set back to follow whichever terminal attaches next.
  async resizeWindow(name: string, size: { cols: number; rows: number }): Promise<void> {
    await this.run(['resize-window', '-t', `=${name}:`, '-x', String(size.cols), '-y', String(size.rows)]);
    await this.run(['set-option', '-w', '-t', `=${name}:`, 'window-size', 'latest']);
  }

  async windowSize(name: string): Promise<{ cols: number; rows: number }> {
    const out = await this.run(['display-message', '-p', '-t', `=${name}:`, '#{window_width} #{window_height}']);
    const [cols, rows] = out.trim().split(' ').map(Number);
    return { cols, rows };
  }

  async killServer(): Promise<void> {
    try {
      await this.run(['kill-server']);
    } catch (e) {
      if (!NOT_RUNNING.test(stderrOf(e))) throw e;
    }
  }

  attachArgs(name: string): string[] {
    return [...this.base, 'attach-session', '-t', `=${name}`];
  }
}
