import { execFile } from 'node:child_process';

// What a Claude started here in a terminal's place keeps of that terminal's environment: all of it, so what
// was set up there goes on working (a virtualenv, a cloud profile, the hooks of the app the terminal is in),
// but for what describes the terminal itself, which tmux sets anew, and what marks a program run inside another.
const OF_THE_TERMINAL = new Set([
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'COLORTERM',
  'TMUX',
  'TMUX_PANE',
  'SHLVL',
  'PWD',
  'OLDPWD',
  '_',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'WORKOFFDESK_SESSION',
]);
// A shell's exported functions (BASH_FUNC_name%%) are not variables tmux can set; the login shell defines its own.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function fromTerminal(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string' && NAME.test(e[0]) && !OF_THE_TERMINAL.has(e[0])),
  );
}

const PS_MS = 5_000;

const ps = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('/bin/ps', ['-ww', ...args], { timeout: PS_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout).replace(/\n$/, '')),
    ),
  );

// The environment a process of this user started with, as ps shows it after its arguments: NAME=value, one
// after another with a space between, so a value holding " NAME=" is cut there. Empty when it is gone.
export async function environmentOf(pid: number): Promise<Record<string, string>> {
  const [args, withEnv] = await Promise.all([ps(['-o', 'args=', '-p', String(pid)]), ps(['-E', '-o', 'args=', '-p', String(pid)])]).catch(() => ['', '']);
  if (!args || !withEnv.startsWith(`${args} `)) return {};
  return Object.fromEntries(
    withEnv
      .slice(args.length + 1)
      .split(/ (?=[A-Za-z_][A-Za-z0-9_]*=)/)
      .flatMap((pair) => {
        const at = pair.indexOf('=');
        return at > 0 ? [[pair.slice(0, at), pair.slice(at + 1)]] : [];
      }),
  );
}
