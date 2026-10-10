# 工作原理

[English](how-it-works.md) · 简体中文

## 由哪几部分组成

- **服务**是 Mac 上的一个 Node 服务器，监听 `127.0.0.1`,提供网页应用和 API,以 launchd agent 的方式运行。
- **网页应用**就是手机打开的那个页面，可以添加到主屏幕、接收推送通知。iPhone App 是原生(React Native)App,
  用的是同一套 API。
- **tmux** 装着各个会话，用的是服务自己的 tmux server(`tmux -L workoffdesk`)。

## 会话住在 tmux 里

每个会话是一个名叫 `wod-<id>` 的 tmux 会话。Claude 在里面运行，结束后是一个登录 shell。手机从不挂终端：按键经
`tmux send-keys` 送进去，一条消息是一次粘贴(程序要求时用 bracketed paste),再加一个回车。会话归 tmux 管，
所以关掉网页、手机锁屏、重启服务都不会结束它,`workoffdesk attach` 在 Mac 终端里接上的也正是同一个会话。

## 聊天来自 transcript

Claude Code 把每个对话写进 `~/.claude/projects/<目录>/<会话>.jsonl`。服务只读新增的部分，经会话的 WebSocket
推给手机。手机把读过的内容存一份(IndexedDB,每个会话最新的 1500 条),所以打开会话是瞬间的，只取新的几行。

## 状态来自 hook

服务启动的每个 Claude 都带着 `--settings`,里面是各种事件的 hook(发出提示、用了工具、通知、停下、压缩、
会话开始和结束)。每个 hook 把事件发到服务 home 里一个只有你能读写的 Unix socket。列表靠它知道 Claude 在干活
还是在等你，以及什么时候通知你。你自己的 Claude Code 设置不会被改动。

## 选项从屏幕上读

transcript 里没有的，屏幕上有：提问和权限确认的选项、多选题的勾选框、`/usage` 这类打开的面板。服务读取窗格
(`tmux capture-pane`)找出它们。替你按键之前，它会再读一次屏幕，选项还是你看到的那些才按。

## Claude 接不了的时候，消息先等着

Claude 在干活时，消息直接送进去，进 Claude Code 自己的队列。Claude 正在启动、在问你问题、在压缩上下文、
或者已经结束时，打字会落到不该去的地方，所以消息先按顺序存在 Mac 上的 `journal.db` 里。Claude 一能接收就
送进去，重启服务也不会丢。

## Codex 走它的 app server

Codex 有一个可以让多个客户端共用的 app server。服务每个安装只起一个，跑在自己的 tmux 会话里，监听服务目录下
的一个 Unix socket;每个 Codex 会话就是连着它的 Codex 终端界面。服务加入同一个对话，所以每条消息、每次状态
变化、每个权限请求都即时收到;你在手机上打的字，作为这个对话的一轮发进去。这条路不需要 hook,也不用读屏。

## 接管终端里的 Claude

`claude agents --json` 列出 Mac 上正在跑的 Claude Code。不在任何 workoffdesk 会话里的(环境变量里没有
`WORKOFFDESK_SESSION`)可以接管：服务给它发 SIGTERM,它像按了 Ctrl-C 一样把 transcript 写完再退出，然后服务在
一个新会话里续上这个对话，带着那个 Claude 原来的环境变量。从这边不会让两个 Claude 同时写同一个对话。

## 一段话讲安全

一个安装只有一个用户，用密码(存的是 scrypt 哈希)和 Passkey 登录。登录有效 30 天，可以吊销。登录失败太多次，
先锁那个地址，再锁所有人，各锁一段时间。会改动东西的请求和所有 WebSocket 都必须来自配置的 origin。页面不从
别的网站加载任何东西。见 [SECURITY.md](../../SECURITY.md)。
