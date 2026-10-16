# 安装

[English](install.md) · 简体中文

## 需要什么

- 一台 Mac。服务是 launchd agent,只能跑在 macOS 上。
- Node 22.13 及以上,tmux 3.3 及以上。
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code),`claude` 在 `~/.local/bin` 或 `PATH` 里。
- 一条让手机用 HTTPS 连到这台 Mac 的路。见[外网访问](remote-access.zh-CN.md)。

## 安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/workoffdesk/workoffdesk/main/install.sh | bash
```

不是 macOS、或者没装 [Homebrew](https://brew.sh),它会直接停下。否则它：

1. 用 Homebrew 装 tmux 和 Node,已经有的不装;
2. 全局安装 npm 包 `workoffdesk`;
3. 跑一次 `workoffdesk doctor`;
4. 在终端里运行、并且这台 Mac 还没设置过时，接着打开[浏览器里的设置](#在浏览器里设置);否则打印接下来的步骤。

它从不用 `sudo`。npm 的全局 `bin` 目录不在 `PATH` 里时，它会告诉你往 `~/.zprofile` 加哪一行。

## 不用脚本

```bash
brew install tmux node
npm i -g workoffdesk
```

## 在浏览器里设置

```bash
workoffdesk setup --web
```

它在这台 Mac 上打开一个页面，带你走完剩下的步骤：这台 Mac 缺什么，每一项给出要运行的命令;账号;手机要打开的
地址(Tailscale 在运行时用它的地址，或者你已有的 Cloudflare 隧道，或者自己填一个);最后安装并启动服务，把地址
显示成二维码给手机相机扫。它做的事和下面这些命令一样。

这个页面只在 `127.0.0.1` 上提供，而且只认打开它打印出来那个地址的浏览器。点「完成」、按 Ctrl-C,或者 30 分钟
没人用，它就结束。

## 设置

```bash
workoffdesk setup --origin https://workoffdesk.example.com
```

`--origin` 是手机要打开的地址。只在这台 Mac 上试的话用 `http://localhost:7681`。
`setup` 会问用户名和密码(至少 12 位;也可以用 `--username` 传用户名、从标准输入传密码),写进
`~/.workoffdesk/config.json`。地址是 HTTPS 时，它会把地址打印成二维码，用手机相机扫就能打开。

再跑一次 `setup` 会替换用户名和密码，并让所有设备退出登录;不传新的 `--origin` 时，其他配置不变。

装成服务之前想先试试：

```bash
workoffdesk serve      # 在这台 Mac 上打开 http://127.0.0.1:7681
```

## 装成服务

```bash
workoffdesk install
```

`install` 写好 `~/Library/LaunchAgents/local.workoffdesk.plist` 和 `~/.local/bin/workoffdesk` 命令，用的是
执行它的那个 Node(`--node <路径>` 可以换)。它不启动任何东西，只打印接下来要执行的命令，第一条是：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.workoffdesk.plist
```

或者 `workoffdesk start`,它还会等服务应答。之后每次登录 Mac,服务都会自己启动。`workoffdesk stop` 让它停到
下次登录或 `start`;`workoffdesk restart` 重启它，不会结束会话。`install --tunnel <名字>` 还会接上 Cloudflare 隧道，见
[外网访问](remote-access.zh-CN.md)。

## 检查

```bash
workoffdesk doctor
```

| 检查项 | 什么时候算通过 |
|---|---|
| `macos` | 跑在 macOS 上。 |
| `node` | Node 是 22.13 及以上。 |
| `tmux` | tmux 是 3.3 及以上。 |
| `claude` | Claude Code 能运行。 |
| `codex` | 总是通过：只说明有没有 Codex,它是可选的。 |
| `setup` | 跑过 `setup`,配置有效。 |
| `service` | 服务在它的端口上应答，并且版本和这个命令一样。 |
| `origin` | 你的地址能连到服务(`http://localhost` 地址直接通过，只限本机)。 |
| `sleep` | 服务开着时 Mac 不会因为闲置而睡眠。 |
| `apns` | 没有配 iPhone 推送密钥，或者 `apns.json` 里那把能读到。 |

每个 ✗ 下面都写着修复它的命令或改法;有任何一项不过,`doctor` 的退出码就是 1。
你的 HTTPS 地址能连到服务时，它会再打印一次二维码。

## 菜单栏 App

仓库里的 `apps/mac` 是 Mac 的菜单栏 App:图标显示服务在运行、有问题还是停了，有会话在干活时图标上走进度条;菜单里列出没通过的检查和修复命令
(点一下复制)、最近一天的错误、启动/停止/重启、在浏览器中打开、地址的二维码、打开日志文件夹和登录时打开;
有不止一个 Claude 账号时，还能选会话用哪个账号，并把开着的会话搬过去。它的
一切都通过 `workoffdesk` 命令去读、去做(`status --json`、`activity --json`、`account --json`)，所以要先装好服务。用 Xcode 命令行工具构建：

```bash
apps/mac/scripts/build-app.sh      # 生成 apps/mac/build/WorkOffDesk.app
```

这个 App 只签给这台 Mac 用;挪到「应用程序」里打开即可。

## 卸载

```bash
launchctl bootout gui/$(id -u)/local.workoffdesk
rm ~/Library/LaunchAgents/local.workoffdesk.plist ~/.local/bin/workoffdesk
tmux -L workoffdesk kill-server     # 结束它开着的所有会话
npm rm -g workoffdesk
rm -rf ~/.workoffdesk               # 配置、登录、上传的文件和日志
```

用了隧道的话，再执行 `launchctl bootout gui/$(id -u)/local.workoffdesk-tunnel`,并删掉
`~/Library/LaunchAgents/local.workoffdesk-tunnel.plist`。
