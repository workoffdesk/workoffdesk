// What the CLI says to the person at the Mac: Chinese when the Mac speaks it, English otherwise.
// The phone has its own dictionary (@workoffdesk/i18n); errors the server sends it go by code, not words.


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
    wouldNotQuit: (agent: string) => `${agent} in the terminal on the Mac did not quit within 10 seconds; nothing was resumed`,
    openElsewhere: 'this conversation is open in another Codex app (an editor or the Codex app); close it there first',
    // Said in the terminal it was quit in.
    goneToPhone: (id: string) => `workoffdesk: this conversation now goes on in workoffdesk. To go on with it here: workoffdesk attach ${id}`,
  },
  goOn: {
    onlyClaude: 'only a Claude session whose Claude quit is gone on with in place',
    terminalBusy: "something runs in this session's terminal on the Mac; quit it there first, or start another conversation",
  },
  folderGone: (path: string) => `its folder is gone: ${path}`,
};

export type Messages = typeof en;

export const zh: Messages = {
  cli: {
    usage: '用法：workoffdesk <命令>',
    unknownCommand: (cmd) => `没有 ${cmd} 这个命令。`,
    help: {
      setup: [
        ['setup', '设用户名和密码；再跑一次会换新密码，所有设备都要重新登录'],
        ['setup --web', '在浏览器里做设置，包括地址和服务'],
      ],
      install: [['install [--tunnel <名字>]', '写好 launchd 服务（不启动），并打印接下来要跑的命令']],
      start: [['start', '启动服务，等它应答']],
      stop: [['stop', '停掉服务，直到下次登录或 start']],
      restart: [['restart', '重启服务；会话继续跑']],
      doctor: [['doctor', '检查所有项，每项没过都给出修复方法']],
      status: [['status --json', '以 JSON 输出检查结果、版本、保留的各版本和最近的错误']],
      claude: [['claude [--resume <会话 id>]', '在当前目录开一个 Claude 会话并接上']],
      codex: [['codex [--resume <对话 id>]', '在当前目录开一个 Codex 会话并接上']],
      attach: [['attach [id]', '在当前终端接上一个会话；不给 id 就让你挑']],
      account: [
        ['account [--json]', '这台 Mac 上的 Claude 账号，以及新会话用哪一个'],
        ['account use <邮箱或目录> [--move]', '新会话改用它；加 --move 把开着的会话也搬过去'],
        ['account move', '把开着的会话搬到正在用的账号，每个等它这轮回复完再搬'],
      ],
      serve: [['serve', '在当前终端里跑服务器，而不是作为后台服务']],
      deploy: [['deploy <构建目录>', '把一个构建装成新版本并切过去']],
      rollback: [['rollback', '回到上一个版本']],
      '--version': [['--version', '打印装的版本']],
      '--help': [['--help', '打印这张列表']],
    },
    statusUsage: '用法：workoffdesk status --json（给菜单栏 App 读的；给人看用 doctor）',
    notConfigured: (example) => `还没有配置。告诉 setup 这个站点的访问地址：\n  workoffdesk setup --origin ${example}`,
    askOrigin: (example) => `站点的访问地址（手机打开的那个，比如 ${example}）：`,
    askUsername: '用户名：',
    emptyUsername: '用户名不能为空',
    askPassword: (min) => `密码（至少 ${min} 个字符）：`,
    askAgain: '再输一次：',
    passwordsDiffer: '两次输入的密码不一致',
    passwordTooShort: (min) => `密码至少要 ${min} 个字符`,
    setUp: (username, origin, configFile, port) => `用户 ${username} 已设置好，地址 ${origin}。配置：${configFile}

下一步：
  workoffdesk serve      先在本机试一下（http://127.0.0.1:${port}）
  workoffdesk install    装成登录时自动启动的服务，并看看怎么在前面接隧道或反向代理
开放到公网之前，先读 SECURITY.md：谁进得了这个站点，谁就拿到了这台电脑的终端。`,
    notSetUp: '还没有设置用户。运行：workoffdesk setup',
    scan: (origin) => `用手机相机扫一下，打开 ${origin}：`,
    running: (port, origin) => `workoffdesk 正在 http://127.0.0.1:${port} 上运行，访问地址 ${origin}`,
    noSessions: '没有会话。',
    whichOne: '选哪一个？',
    noSuchNumber: '没有这个编号',
    notRunning: 'WorkOffDesk 服务没有在运行。先启动它（workoffdesk serve，或已安装的服务）。',
    couldNotOpen: (why) => `打不开会话：${why}`,
    noTunnel: (name) => `没有叫 ${name} 的隧道。运行：\n  cloudflared tunnel create ${name}\n然后再运行一次 workoffdesk install --tunnel ${name}。`,
    noCloudflared: '找不到 cloudflared。先运行 brew install cloudflared。',
    notBuilt: (cliPath) => `注意：${cliPath} 还不存在，先构建（pnpm build）。`,
    noCredentials: (file) => `注意：隧道凭据 ${file} 不在这台电脑上；请在创建这条隧道的电脑上运行它。`,
    frontDoor: (port, origin) => `服务只监听 http://127.0.0.1:${port}。需要在它前面放一个能把 ${origin} 转到这里的东西：
  Cloudflare 隧道：cloudflared tunnel create <名字>，然后 workoffdesk install --tunnel <名字>
  或任何反向代理（Caddy、nginx…），把 ${origin} 转发到 http://127.0.0.1:${port}，并支持 WebSocket`,
    installed: (o) => `node：${o.nodePath}（换了 node 版本之后，用 --node <路径> 再运行一次 install）
已写入：
${o.written.map((f) => `  ${f}`).join('\n')}
${o.warnings.length ? `\n${o.warnings.join('\n')}\n` : ''}
现在要运行的命令（只需第一次）：
${o.frontDoor}

以后更新：workoffdesk deploy <构建目录>；需要时 workoffdesk rollback。
只重启服务：launchctl kickstart -k gui/$(id -u)/${o.label}`,
    deployUsage: '用法：workoffdesk deploy <构建目录> [--new-app-runtime]（构建目录是 pnpm deploy --prod 生成的那个）',
  },
  doctor: {
    notFound: '找不到',
    unknownVersion: (version) => `看不出版本（${version}）`,
    tooOld: (version, min) => `${version}；需要 ${min} 或更高`,
    macosOnly: '服务只支持 macOS（它用 launchd，管的是这台 Mac 上的 Claude Code 会话）。',
    nodeFix: (min) => `装 node ${min} 或更高版本（brew install node，或 nvm install 22），然后再运行一次 workoffdesk install。`,
    tmuxFix: 'brew install tmux',
    claudeFix: '安装 Claude Code：curl -fsSL https://claude.ai/install.sh | bash',
    noCodex: '没有安装（可选：用来开 Codex 会话）',
    setupFix: 'workoffdesk setup',
    setUp: (user, origin) => `用户 ${user}，地址 ${origin}`,
    notSetUp: (home) => `还没有设置（${home} 里没有 config.json）`,
    noUser: '还没有设置用户',
    running: (local, version) => `在 ${local} 上运行${version ? `，版本 ${version}` : ''}`,
    notAnswering: (local) => `${local} 上没有回应`,
    otherVersion: (local, running, mine) => `${local} 上跑的是 ${running}，这个命令是 ${mine}`,
    restartFix: (label) => `重启它：launchctl kickstart -k gui/$(id -u)/${label}`,
    installFix: '把它装成服务:workoffdesk install,再执行它打印的那行 launchctl bootstrap(或者用 workoffdesk serve 先试)',
    bootstrapFix: (plist) => `启动它:launchctl bootstrap gui/$(id -u) ${plist}`,
    kickstartFix: (label, log) => `重启它:launchctl kickstart -k gui/$(id -u)/${label};如果又停了，原因在 ${log}`,
    localOnly: (origin) => `${origin}：只有这台 Mac 能访问`,
    notReached: (origin) => `${origin} 到不了服务`,
    originFix: (origin, local) => `检查把 ${origin} 转到 ${local} 的隧道或反向代理。`,
    sleepsOff: 'preventSleep 是 false：Mac 空闲睡眠之后，手机就连不上，直到有人把它叫醒',
    sleepFix: (file) => `把 ${file} 里的 "preventSleep": false 删掉，然后重启服务。`,
    awake: '服务运行时 Mac 不会空闲睡眠',
    noApns: '没有推送密钥：iPhone App 收不到通知；网页推送不受影响',
    apnsKey: (keyId) => `推送密钥 ${keyId}`,
    apnsFix: (file) => `改好 ${file}；不用 iPhone App 的话删掉它。`,
    failed: '有检查没通过；每个 ✗ 下面写了怎么办。',
  },
  ops: {
    started: (port) => `服务已在 http://127.0.0.1:${port} 运行`,
    stopped: '服务已停止；下次登录时会再启动，或运行 workoffdesk start',
    restarted: '服务已重启',
    notUp: (log) => `服务 30 秒内没有应答；原因多半在 ${log}`,
  },
  wizard: {
    open: (url) => `接下来在浏览器里设置。如果没有自动打开，在这台 Mac 上打开这个地址：\n  ${url}\n按 Ctrl-C 结束。`,
    idle: '设置页 30 分钟没人用，已经结束。再运行 workoffdesk setup --web 重新开始。',
    done: '设置完成。',
    notReady: '先设好账号和地址',
    noTailscale: '这台 Mac 上的 Tailscale 没有运行',
    tailscaleFailed: (out) => `tailscale serve 失败：${out}`,
    noTunnel: (name) => `这台 Mac 上没有叫 ${name} 的 Cloudflare 隧道`,
    badHostname: '主机名是 workoffdesk.example.com 这样的名字，不带 https:// 也不带路径',
    routeFailed: (out) => `cloudflared 没能把主机名指到隧道：${out}`,
  },
  node: {
    doesNotRun: (node) => `${node} 运行不了。`,
    tooOld: (node, version, min) => `${node} 是 ${version}；WorkOffDesk 需要 node ${min} 或更高版本。`,
  },
  config: {
    wrong: (field, expected) => `config.json：${field} 不对，应该是${expected}`,
    origin: '站点的访问地址，比如 https://workoffdesk.example.com（在本机试用就用 http://localhost:<端口>）',
    port: '1 到 65535 之间的整数',
    rpId: (hostname) => `站点的主机名（${hostname}）或它的上级域名`,
    pinnedDirs: '文件夹路径的数组',
    serviceLabel: '由字母、数字、点和连字符组成的 launchd 标签',
    claudeArgs: '启动 claude 时带的参数数组，比如 ["--chrome"]',
    preventSleep: 'true（服务运行时不让 Mac 空闲睡眠）或 false',
    missing: (file) => `已设置的，但 ${file} 还不存在；先运行 workoffdesk setup`,
    format: '格式',
    notJson: (why) => `合法的 JSON（${why}）`,
  },
  release: {
    notABuild: (dir) => `${dir} 不是一个构建（需要有 package.json 和 dist/server/cli.js）`,
    smokeFailed: (version) => `${version} 没通过冒烟测试；正在运行的版本没动`,
    didNotComeUp: (version, prev) => `${version} 30 秒内没有起来；${prev ? `已切回 ${prev}` : '没有更早的版本可以切回'}`,
    staleBuild: (version, built) => `这个构建写的是 ${version}，但它的 dist ${built ? `是为 ${built} 构建的` : '不是一次完整构建产出的'}；重新运行 pnpm build`,
    deployed: (version, name) => `已部署 ${version}（${name}）`,
    builtFrom: (s) => (s.commit ? `构建自 ${s.commit.slice(0, 12)}${s.dirty ? '，带未提交的改动' : ''}` : '不是在 git 里构建的'),
    appUpdate: (runtime) => (runtime ? `iPhone 应用更新，运行时 ${runtime}` : '这个构建没有 iPhone 应用更新'),
    appRuntimeChanged: (live, built) =>
      `线上的 iPhone 应用更新是给运行时 ${live} 的，这个构建的${built ? `却是给 ${built} 的` : '没有（设了 WORKOFFDESK_IOS_BUNDLE_ID 吗？）'}，装着 ${live} 的手机就再也收不到更新。App 的 JavaScript 以外的改动（它的 package.json 或 app 配置）会改变运行时。只有 App 的新版本发出去以后，才用 --new-app-runtime 部署`,
    nothingToRollBackTo: '没有更早的版本可以回滚',
    rollbackFailed: (target, current) => `${target} 没有起来；已切回 ${current}`,
    rolledBack: (version, name) => `已回滚到 ${version}（${name}）`,
  },
  account: {
    usage: '用法：workoffdesk account [--json] | account use <邮箱或目录> [--move] | account move',
    signedOut: '已退出登录',
    notReady: '先在终端里用它打开一次 Claude Code',
    apart: '它的对话没有和这台 Mac 的共用',
    notSeen: '还没看到它的用量',
    fiveHour: (p) => `5 小时 ${p}`,
    sevenDay: (p) => `7 天 ${p}`,
    reset: '已重置',
    elsewhere: (n) => `${n} 个开着的会话在别的账号上。搬过来：workoffdesk account move`,
    moving: (n) => `${n} 个会话等这轮回复完就搬过来。`,
    noSuch: (who) => `这台 Mac 上没有 ${who} 这个 Claude 账号。`,
    twoWithEmail: (email, folders) => `不止一个账号是 ${email}，改用目录指定：${folders.join('、')}`,
    nonePicked: '还没有选过账号。先选一个：workoffdesk account use <邮箱或目录>',
  },
  takeOver: {
    openOnMac: (ttys, agent) => `这个对话正开在 Mac 的终端里${ttys.some(Boolean) ? `（${ttys.filter(Boolean).join('、')}）` : ''}；先在那里退出 ${agent}，或者从手机上接管`,
    wouldNotQuit: (agent) => `Mac 终端里的 ${agent} 10 秒内没有退出；没有续上`,
    openElsewhere: '这个对话开在别的 Codex 应用里（编辑器或 Codex 桌面版）；先在那里关掉',
    goneToPhone: (id) => `workoffdesk：这个对话已转到 workoffdesk 里接着进行。要在这台电脑上接着用：workoffdesk attach ${id}`,
  },
  goOn: {
    onlyClaude: '只有 Claude 已退出的 Claude 会话能原地接着',
    terminalBusy: '这个会话在 Mac 的终端里正跑着别的程序；先在那里退出它，或者重新开一个对话',
  },
  folderGone: (path: string) => `它的文件夹已经不在了：${path}`,
};

export const messagesFor = (languages: readonly string[]): Messages => (pickLang(languages) === 'zh' ? zh : en);

export const m = messagesFor(systemLanguages());
