// What the CLI says to the person at the Mac: Chinese when the Mac speaks it, English otherwise.
// The phone has its own dictionary (@workoffdesk/i18n); errors the server sends it go by code, not words.

import { zh } from './messages.zh.js';

export { zh };

export type Lang = 'en' | 'zh';

// The same rule as the phone's.
export function pickLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    if (/^zh\b/i.test(l)) return 'zh';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}

// The locale the terminal runs in, as a language tag: zh_CN.UTF-8 is zh-CN.
export function systemLanguages(env: NodeJS.ProcessEnv = process.env): string[] {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const locale = env[name]?.replace(/[.@].*$/, '');
    if (locale && locale !== 'C' && locale !== 'POSIX') return [locale.replace(/_/g, '-')];
  }
  return [Intl.DateTimeFormat().resolvedOptions().locale];
}

type Install = { nodePath: string; written: string[]; warnings: string[]; frontDoor: string; label: string };

export const en = {
  cli: {
    usage: 'Usage: workoffdesk <command>',
    unknownCommand: (cmd: string) => `There is no command ${cmd}.`,
    // Each command, in the order shown, with its forms; cli.ts runs exactly these names.
    help: {
      setup: [
        ['setup', 'Set the username and password; run again, a new password signs every device out'],
        ['setup --web', 'The setup in your browser, with the address and the service'],
      ],
      install: [['install [--tunnel <name>]', 'Write the launchd service (it starts nothing) and print what to run']],
      start: [['start', 'Start the service and wait for it to answer']],
      stop: [['stop', 'Stop the service until the next login or start']],
      restart: [['restart', 'Restart the service; sessions keep running']],
      doctor: [['doctor', 'Check everything and print the fix for each failure']],
      status: [['status --json', 'The checks, the version, the releases and the newest errors, as JSON']],
      activity: [['activity --json', 'How many sessions are working: a line of JSON now and at each change']],
      claude: [['claude [--resume <session id>]', 'Start Claude in this folder as a session and join it']],
      codex: [['codex [--resume <thread id>]', 'Start Codex in this folder as a session and join it']],
      attach: [['attach [id]', 'Join a session from this terminal; without an id, pick one']],
      account: [
        ['account [--json]', 'The Claude accounts on this Mac, and the one new sessions start on'],
        ['account use <email or folder> [--move]', 'Start new sessions on it; with --move, move the open ones to it too'],
        ['account move', 'Move the open sessions to the account in use, each once its reply is done'],
      ],
      serve: [['serve', 'Run the server in this terminal instead of as the service']],
      deploy: [['deploy <build folder>', 'Install a build as a new release and switch to it']],
      rollback: [['rollback', 'Go back to the release before']],
      '--version': [['--version', 'Print the installed version']],
      '--help': [['--help', 'Print this list']],
    },
    statusUsage: 'Usage: workoffdesk status --json (what the menu bar app reads; doctor is the one for people)',
    activityUsage: 'Usage: workoffdesk activity --json (what the menu bar app reads)',
    notConfigured: (example: string) => `Not configured yet. Tell setup the address the site is reached at:\n  workoffdesk setup --origin ${example}`,
    askOrigin: (example: string) => `The address the site is reached at (the one the phone opens, like ${example}): `,
    askUsername: 'Username: ',
    emptyUsername: 'The username cannot be empty',
    askPassword: (min: number) => `Password (at least ${min} characters): `,
    askAgain: 'Again: ',
    passwordsDiffer: 'The passwords do not match',
    passwordTooShort: (min: number) => `The password needs at least ${min} characters`,
    setUp: (username: string, origin: string, configFile: string, port: number) => `User ${username} is set up, at ${origin}. Config: ${configFile}

Next:
  workoffdesk serve      try it on this machine first (http://127.0.0.1:${port})
  workoffdesk install    install it as a service that starts at login, and see how to put a tunnel or reverse proxy in front
Before opening it to the internet, read SECURITY.md: whoever gets into this site gets this machine's terminal.`,
    notSetUp: 'No user is set up yet. Run: workoffdesk setup',
    scan: (origin: string) => `Open ${origin} on your phone with its camera:`,
    running: (port: number, origin: string) => `workoffdesk is running on http://127.0.0.1:${port}, reached at ${origin}`,
    noSessions: 'There are no sessions.',
    whichOne: 'Which one? ',
    noSuchNumber: 'There is no such number',
    notRunning: 'The WorkOffDesk service is not running. Start it first (workoffdesk serve, or the installed service).',
    couldNotOpen: (why: string) => `Could not open a session: ${why}`,
    noTunnel: (name: string) => `There is no tunnel named ${name}. Run:\n  cloudflared tunnel create ${name}\nthen workoffdesk install --tunnel ${name} again.`,
    noCloudflared: 'cloudflared not found. Run brew install cloudflared first.',
    notBuilt: (cliPath: string) => `Note: ${cliPath} does not exist yet; build first (pnpm build).`,
    noCredentials: (file: string) => `Note: the tunnel credentials ${file} are not here; run the tunnel on the machine that created it.`,
    frontDoor: (port: number, origin: string) => `The service listens only on http://127.0.0.1:${port}. Put something in front of it that brings ${origin} there:
  a Cloudflare tunnel: cloudflared tunnel create <name>, then workoffdesk install --tunnel <name>
  or any reverse proxy (Caddy, nginx…) forwarding ${origin} to http://127.0.0.1:${port}, with WebSocket support`,
    installed: (o: Install) => `node: ${o.nodePath} (after changing node versions, run install again with --node <path>)
Written:
${o.written.map((f) => `  ${f}`).join('\n')}
${o.warnings.length ? `\n${o.warnings.join('\n')}\n` : ''}
Commands to run now (only the first time):
${o.frontDoor}

To update later: workoffdesk deploy <build folder>; workoffdesk rollback if needed.
To restart the service only: launchctl kickstart -k gui/$(id -u)/${o.label}`,
    deployUsage: 'Usage: workoffdesk deploy <build folder> [--new-app-runtime] (the folder pnpm deploy --prod makes)',
  },
  doctor: {
    notFound: 'not found',
    unknownVersion: (version: string) => `cannot tell its version (${version})`,
    tooOld: (version: string, min: string) => `${version}; ${min} or later is needed`,
    macosOnly: 'The service runs on macOS only (it uses launchd, and Claude Code sessions on this Mac).',
    nodeFix: (min: string) => `Install node ${min} or later (brew install node, or nvm install 22), then run workoffdesk install again.`,
    tmuxFix: 'brew install tmux',
    claudeFix: 'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash',
    noCodex: 'not installed (optional: for Codex sessions)',
    setupFix: 'workoffdesk setup',
    setUp: (user: string, origin: string) => `user ${user}, at ${origin}`,
    notSetUp: (home: string) => `not set up yet (no config.json in ${home})`,
    noUser: 'no user is set up yet',
    running: (local: string, version: string | undefined) => `running on ${local}${version ? `, version ${version}` : ''}`,
    notAnswering: (local: string) => `nothing answers on ${local}`,
    otherVersion: (local: string, running: string, mine: string) => `${local} runs ${running}, but this is ${mine}`,
    restartFix: (label: string) => `Restart it: launchctl kickstart -k gui/$(id -u)/${label}`,
    installFix: 'Make it a service: workoffdesk install, then run the launchctl bootstrap line it prints (or workoffdesk serve to try it)',
    bootstrapFix: (plist: string) => `Start it: launchctl bootstrap gui/$(id -u) ${plist}`,
    kickstartFix: (label: string, log: string) => `Restart it: launchctl kickstart -k gui/$(id -u)/${label}; if it stops again, the reason is in ${log}`,
    localOnly: (origin: string) => `${origin}: only this Mac can reach it`,
    notReached: (origin: string) => `${origin} does not reach the service`,
    originFix: (origin: string, local: string) => `Check the tunnel or reverse proxy that should bring ${origin} to ${local}.`,
    sleepsOff: 'preventSleep is false: when the Mac idle-sleeps, the phone cannot reach it until someone wakes it',
    sleepFix: (file: string) => `Remove "preventSleep": false from ${file}, then restart the service.`,
    awake: 'the Mac does not idle-sleep while the service runs',
    noApns: 'no push key: the iPhone app gets no notifications; web push works without it',
    apnsKey: (keyId: string) => `push key ${keyId}`,
    apnsFix: (file: string) => `Fix ${file}, or remove it if you do not use the iPhone app.`,
    failed: 'Some checks failed; each ✗ says what to do.',
  },
  ops: {
    started: (port: number) => `The service is running on http://127.0.0.1:${port}`,
    stopped: 'The service is stopped; it starts again at the next login, or with workoffdesk start',
    restarted: 'The service restarted',
    notUp: (log: string) => `The service did not answer within 30 seconds; the reason is likely in ${log}`,
  },
  wizard: {
    open: (url: string) => `Setup continues in the browser. If it did not open, open this address on this Mac:\n  ${url}\nCtrl-C ends it.`,
    idle: 'Nobody used the setup page for 30 minutes, so it ended. Run workoffdesk setup --web to start it again.',
    done: 'Setup is done.',
    notReady: 'Set up the account and the address first',
    noTailscale: 'Tailscale is not running on this Mac',
    tailscaleFailed: (out: string) => `tailscale serve failed: ${out}`,
    noTunnel: (name: string) => `There is no Cloudflare tunnel named ${name} on this Mac`,
    badHostname: 'The hostname is a name like workoffdesk.example.com, without https:// or a path',
    routeFailed: (out: string) => `cloudflared could not point the hostname at the tunnel: ${out}`,
  },
  node: {
    doesNotRun: (node: string) => `${node} does not run.`,
    tooOld: (node: string, version: string, min: string) => `${node} is ${version}; WorkOffDesk needs node ${min} or later.`,
  },
  config: {
    wrong: (field: string, expected: string) => `config.json: ${field} is wrong; it should be ${expected}`,
    origin: 'the address the site is reached at, like https://workoffdesk.example.com (http://localhost:<port> to try it on this machine)',
    port: 'a whole number from 1 to 65535',
    rpId: (hostname: string) => `the site's hostname (${hostname}) or a domain above it`,
    pinnedDirs: 'an array of folder paths',
    serviceLabel: 'a launchd label of letters, digits, dots and hyphens',
    claudeArgs: 'an array of arguments claude is started with, like ["--chrome"]',
    extraOrigins: 'an array of other https addresses the site is also reached at, like ["https://other.example.com"]',
    preventSleep: 'true (keep the Mac from idle-sleeping while the service runs) or false',
    missing: (file: string) => `set, but ${file} does not exist yet; run workoffdesk setup first`,
    format: 'the format',
    notJson: (why: string) => `valid JSON (${why})`,
  },
  release: {
    notABuild: (dir: string) => `${dir} is not a build (it needs package.json and dist/server/cli.js)`,
    smokeFailed: (version: string) => `${version} failed its smoke test; the running version is untouched`,
    didNotComeUp: (version: string, prev: string | undefined) =>
      `${version} did not come up within 30 seconds; ${prev ? `switched back to ${prev}` : 'there is no earlier version to switch back to'}`,
    staleBuild: (version: string, built: string | null) =>
      `This build says ${version}, but its dist ${built ? `was built for ${built}` : 'is not from a build that finished'}; run pnpm build again`,
    deployed: (version: string, name: string) => `Deployed ${version} (${name})`,
    builtFrom: (s: { commit: string | null; dirty: boolean }) =>
      s.commit ? `Built from ${s.commit.slice(0, 12)}${s.dirty ? ' with uncommitted changes' : ''}` : 'Built outside git',
    appUpdate: (runtime: string | null) => (runtime ? `iPhone app update for runtime ${runtime}` : 'This build has no iPhone app update'),
    appRuntimeChanged: (live: string, built: string | null) =>
      `The live iPhone update is for runtime ${live}, but this build's ${built ? `is for ${built}` : 'is missing (was WORKOFFDESK_IOS_BUNDLE_ID set?)'}, so phones on ${live} would get no more updates. A change outside the app's JavaScript (its package.json or app config) can change the runtime. Deploy with --new-app-runtime only once a new build of the app is out`,
    nothingToRollBackTo: 'There is no earlier version to roll back to',
    rollbackFailed: (target: string, current: string | undefined) => `${target} did not come up; switched back to ${current}`,
    rolledBack: (version: string, name: string) => `Rolled back to ${version} (${name})`,
  },
  // A Claude or Codex conversation open in a terminal on the Mac, taken over to go on in workoffdesk.
  account: {
    usage: 'Usage: workoffdesk account [--json] | account use <email or folder> [--move] | account move',
    signedOut: 'Signed out',
    notReady: 'Open Claude Code with it in a terminal once first',
    apart: 'Its conversations are kept apart from this Mac’s',
    notSeen: 'Not seen in use yet',
    fiveHour: (p: string) => `5-hour ${p}`,
    sevenDay: (p: string) => `7-day ${p}`,
    reset: 'reset',
    elsewhere: (n: number) =>
      n === 1
        ? '1 open session is on another account. To move it: workoffdesk account move'
        : `${n} open sessions are on another account. To move them: workoffdesk account move`,
    moving: (n: number) => (n === 1 ? '1 session moves once its reply is done.' : `${n} sessions move once their reply is done.`),
    noSuch: (who: string) => `There is no Claude account ${who} on this Mac.`,
    twoWithEmail: (email: string, folders: string[]) => `More than one account is ${email}; name its folder instead: ${folders.join(', ')}`,
    nonePicked: 'No account is picked yet. Pick one first: workoffdesk account use <email or folder>',
  },
  takeOver: {
    openOnMac: (ttys: (string | null)[], agent: string) =>
      `this conversation is open in a terminal on the Mac${ttys.some(Boolean) ? ` (${ttys.filter(Boolean).join(', ')})` : ''}; quit ${agent} there first, or take it over from the phone`,
    macUnanswered: 'The Mac did not say in time whether this conversation is open in a terminal there; try again in a moment',
    wouldNotQuit: (agent: string) => `${agent} in the terminal on the Mac did not quit within 10 seconds; nothing was resumed`,
    openElsewhere: 'this conversation is open in another Codex app (an editor or the Codex app); close it there first',
    // Said in the terminal it was quit in.
    goneToPhone: (id: string) => `workoffdesk: this conversation now goes on in workoffdesk. To go on with it here: workoffdesk attach ${id}`,
  },
  goOn: {
    onlyClaude: 'only a Claude session whose Claude quit is gone on with in place',
    terminalBusy: "something runs in this session's terminal on the Mac; quit it there first, or start another conversation",
    conversationGone: (agent: string) => `${agent} no longer keeps this conversation, so it cannot be gone on with; what was said can still be read here`,
  },
  moveThis: {
    cannot: 'only a Claude session here whose Claude runs, in a folder still there, moves to another account',
    busy: 'it moves once Claude is at its prompt with nothing waiting to go in; try again when its reply is done',
    macBusy: 'this conversation is also open in a terminal on the Mac, where Claude is at work or asking something; let it finish there first',
    failed: (why: string) => `it stays on its account: ${why}`,
  },
  folderGone: (path: string) => `its folder is gone: ${path}`,
};

export type Messages = typeof en;

export const messagesFor = (languages: readonly string[]): Messages => (pickLang(languages) === 'zh' ? zh : en);

export const m = messagesFor(systemLanguages());
