# 配置

[English](configuration.md) · 简体中文

## 东西都在哪

都在 `~/.workoffdesk` 里，只有你自己能读。设 `WORKOFFDESK_HOME` 可以换到别处，命令和服务都认。

| 路径 | 是什么 |
|---|---|
| `config.json` | 下面这些设置 |
| `state.json` | 用户、Passkey、已登录的设备和推送订阅 |
| `apns.json` | iPhone App 的推送密钥(用 App 时才有) |
| `journal.db` | 会话的记录，包括等着送给 Claude 的消息 |
| `uploads/` | 手机传上来的文件,30 天后删除 |
| `logs/` | 见[排障](troubleshooting.zh-CN.md) |
| `releases/`、`app` | 用 `deploy` 装的版本，见[升级](upgrade.zh-CN.md) |

## config.json

由 `setup` 写入。服务启动时检查它，哪个字段不对就带着字段名停下。改完要重启服务。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `origin` | —(必填) | 手机打开的地址，比如 `https://workoffdesk.example.com`。`http://localhost:<端口>` 只限本机。 |
| `extraOrigins` | `[]` | 同一个服务的其他 `https://` 访问地址，比如第二条隧道或你自己的服务器:`["https://other.example.com"]`。浏览器在每个地址上都能登录。Passkey 只在创建它的那个地址上能用，除非 `rpId` 是这些地址共同的上级域名。 |
| `port` | `7681` | 服务在 `127.0.0.1` 上监听的端口。 |
| `rpId` | origin 的主机名 | Passkey 绑定的域名：主机名或它的上级域名。改了以后，已有的 Passkey 都会失效。 |
| `pinnedDirs` | `[]` | 新开 Claude 时总会列出的目录。 |
| `claudeArgs` | `[]` | 每次启动 `claude` 时额外带的参数，比如 `["--chrome"]`。加 `--dangerously-skip-permissions` 之前先读 [SECURITY.md](../../SECURITY.md)。 |
| `preventSleep` | `true` | 服务开着时不让 Mac 因为闲置而睡眠。 |
| `serviceLabel` | `local.workoffdesk` | launchd 标签;隧道的标签是它后面加 `-tunnel`。改了以后要重新 `install`。 |

## 睡眠

服务开着时，它持有一个 `caffeinate -i` 断言，所以 Mac 不会因为闲置而睡眠，手机一直连得上。屏幕照样会关，
笔记本合上盖子照样会睡。服务停了，断言也就没了。

想让 Mac 照常睡眠，就设 `"preventSleep": false` 并重启服务。之后 Mac 睡着时手机连不上它,`doctor` 也会报出来。

## iPhone App 的通知

iPhone App 的通知走苹果的推送服务，需要签这个 App 的那个 Apple 开发者团队的一把密钥。网页推送不需要。

1. 在 Apple 开发者账号里:Keys → + → Apple Push Notifications service (APNs),下载
   `AuthKey_<keyId>.p8`。
2. 写 `~/.workoffdesk/apns.json`:

   ```json
   { "teamId": "<Team ID>", "keyId": "<keyId>", "keyFile": "/Users/you/.workoffdesk/AuthKey_<keyId>.p8" }
   ```

3. 重启服务，用 `workoffdesk doctor` 检查。

每台设备先试苹果的正式推送服务(TestFlight 和 App Store 的版本),再试沙盒(从 Xcode 装的版本),记住应答的那一个。

## 重启服务

```bash
launchctl kickstart -k gui/$(id -u)/local.workoffdesk
```

重启服务时，会话照样在跑。
