# 排障

[English](troubleshooting.md) · 简体中文

## 先跑 doctor

```bash
workoffdesk doctor
```

它检查 Mac、设置、服务、你的地址、睡眠和 iPhone 推送密钥，每个 ✗ 都写着怎么办。多数问题到这里就解决了。
同样的检查在手机的「设置 → 这台 Mac」里也有，还带着服务最近的警告和错误;菜单栏 App 里也有。

## 日志

在 `~/.workoffdesk/logs/` 里：

| 文件 | 是什么 |
|---|---|
| `workoffdesk.log` | 服务自己的日志,JSON 行,10 MB 轮转，保留三份 |
| `server.log` | launchd 接住的进程输出;起不来时的报错在这里 |
| `audit.log` | 登录和失败的尝试 |
| `tunnel.log` | 用 Cloudflare 隧道时,cloudflared 的日志 |

## 现象

| 现象 | 看哪里 |
|---|---|
| 服务起不来 | `tail ~/.workoffdesk/logs/server.log`;`launchctl print gui/$(id -u)/local.workoffdesk` 看状态和上次的退出码 |
| `config.json: <字段> is wrong` | 改那个字段，见[配置](configuration.zh-CN.md) |
| `No user is set up yet` | 跑 `workoffdesk setup` |
| 手机打不开网页 | `doctor` 的 `origin` 一项;用隧道的话看 `tunnel.log` 和 `cloudflared tunnel info <名字>` |
| 网页能打开，会话一直连不上 | 你的代理要转发 WebSocket,见[外网访问](remote-access.zh-CN.md) |
| 过一阵手机就连不上 Mac | Mac 睡着了:看 `doctor` 的 `sleep` 一项。笔记本合上盖子照样会睡 |
| 中文变成 `_`、列表乱码 | locale 不是 UTF-8。服务设了 `LANG=en_US.UTF-8`;自己改过 plist 的话检查一下 |
| Claude 的状态一直不变 | hook 通过服务 home 里的一个 socket 上报：看 `workoffdesk.log`。`claude` 要在 `~/.local/bin` 或 `PATH` 里 |
| 登录失败太多次被锁 | 等提示的分钟数;尝试记录在 `audit.log` |
| iPhone App 收不到通知 | `doctor` 的 `apns` 一项;见 [iPhone App 的通知](configuration.zh-CN.md#iphone-app-的通知) |
| 网页推送打不开 | 用 HTTPS 打开网站，并且从添加到主屏幕的图标进入 |

## iPhone App 连不上

- **用局域网地址连同一个 Wi-Fi 下的 Mac:** 在「设置 → 隐私与安全性 → 本地网络」里允许这个 App。
- **国行 iPhone:** 「设置 → 蜂窝网络(无线数据)」里找到这个 App,选「WLAN 与蜂窝网络」。它可能被设成了
  「关闭」或「仅 WLAN」。

## 报告问题

开一个 [issue](https://github.com/workoffdesk/workoffdesk/issues/new/choose),附上 `workoffdesk --version` 和
`workoffdesk doctor` 的输出，以及 `workoffdesk.log` 里出问题前后的几行。贴之前先看一遍：里面有你的地址和路径。
任何不用密码就能进来的问题，请改用[私密报告](https://github.com/workoffdesk/workoffdesk/security/advisories/new)。
