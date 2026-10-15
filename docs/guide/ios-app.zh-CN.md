# iPhone App

[English](ios-app.md) · 简体中文

## 你需要它吗?

多半不需要。网页应用添加到主屏幕后，App 能做的它都能做，推送通知也有。原生 App 给想要它的人用。你自己编译的
版本由你的团队签名，你的 Mac 用你团队的密钥给它发通知。别人发布给大家用的版本拿不到这把密钥，它的通知要经
发布者的中转转交，内容只有你的手机解得开，见[发布给别人用的版本](#发布给别人用的版本)。

## 不连 Mac 先试试

登录页上有「先看看演示」:App 连的是它在手机上模拟的一台 Mac,里面是三个编出来的会话，语言跟 App 一致。
在那里发的消息会由一段写好的回合回答，回答中途可以停下;会话可以新建、结束、改名、置顶。要真 Mac 才能做的
(图片、文件、语音、终端)会说演示里没有。不走任何网络。列表顶上的「连接我的 Mac」离开演示。

## 需要什么

- 一个付费的 Apple 开发者账号。
- Xcode,以及这个仓库和它的依赖(`pnpm install`,见 [CONTRIBUTING.md](../../CONTRIBUTING.md))。
- 一把 Admin 角色的 App Store Connect API 密钥，自动签名要用:App Store Connect → 用户和访问 → 集成 →
  App Store Connect API。把 `.p8` 文件放进 `~/.appstoreconnect/private_keys/`。

## 选定 bundle id 和团队

```bash
export WORKOFFDESK_IOS_BUNDLE_ID=com.yourname.workoffdesk   # 任何你自己的 id
export WORKOFFDESK_TEAM_ID=<你的 Team ID>                    # developer.apple.com → Membership
export ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id>
```

`apps/mobile/app.config.ts` 读取这个 bundle id;不设的话 App 会按 `com.example.workoffdesk` 编译，你签不了名。

## 编译和安装

```bash
cd apps/mobile
./scripts/release-ios.sh              # 编译、签名、上传到 App Store Connect,之后进 TestFlight
./scripts/release-ios.sh --no-upload  # 或者只出 .ipa
```

版本号和 build 号来自 `app.config.ts`;每次上传前把 `ios.buildNumber` 加一。App Store Connect 处理完这个版本
(5–15 分钟)后，从 TestFlight 安装。

## 通知

在同一个团队里建一把 APNs 密钥，写进 `~/.workoffdesk/apns.json`,见
[iPhone App 的通知](configuration.zh-CN.md#iphone-app-的通知)。然后打开 App,用你的服务器地址登录，在它的
设置里打开通知。

## 从你自己的 Mac 拿更新

App 的 JavaScript 更新来自它登录的那台服务器，不经过任何商店。服务器只有在用同一个
`WORKOFFDESK_IOS_BUNDLE_ID` 构建时才提供更新。在这个仓库的一份干净 checkout 里：

```bash
pnpm install --frozen-lockfile
WORKOFFDESK_IOS_BUNDLE_ID=com.yourname.workoffdesk pnpm --filter workoffdesk build
pnpm --filter workoffdesk deploy --prod --legacy ~/workoffdesk-build
workoffdesk deploy ~/workoffdesk-build
```

`workoffdesk deploy` 要求服务从构建目录运行，见[升级](upgrade.zh-CN.md#会自检的升级)。npm 包构建时没有设它，
所以不提供更新,App 跑的是它编译时自带的 JavaScript。改动需要新的原生代码时,App 的 runtime 会变，只有
TestFlight 上的新版本才能带来。改 App 的配置也会，它的 `package.json` 也算在内。构建的 runtime 和线上的不一样时,
`workoffdesk deploy` 会拒绝，因为装着线上那个 runtime 的手机就再也收不到更新;App 的新版本发出去以后，再用
`--new-app-runtime` 部署。

## 发布给别人用的版本

别人不用自己编译就能装的版本，比如 App Store 上的，要连的是不归你的 Mac。编译时在 `WORKOFFDESK_IOS_BUNDLE_ID`
旁边多设两项就行；不设这两项的版本，什么都不变：

- `WORKOFFDESK_IOS_UPDATE_URL`:它的 JavaScript 更新只从这一个地方拿，即你服务器的
  `https://<你的服务器>/api/app-update/manifest`。它不会从它登录的那台 Mac 拿。
- `WORKOFFDESK_IOS_PUSH_RELAY`:你服务器的 https 地址(只要协议和域名),由它把通知转交给苹果。这样编出来的
  版本带一个通知扩展。手机生成一把密钥，存在钥匙串里，交给它登录的每一台 Mac;Mac 用它把每条通知加密后发给
  中转，中转只看得到设备、时间和大小，看不到内容。设这一项还要设 `WORKOFFDESK_TEAM_ID`。

只有你服务器的 `apns.json` 用 `"relayTopic"` 写明这个 App 的 bundle id 时，它才做中转(见
[iPhone App 的通知](configuration.zh-CN.md#iphone-app-的通知)),而且只转这一个 App 的，每台设备每分钟最多
30 条。Mac 上的 workoffdesk 比 App 的 JavaScript 要求的旧时,App 里会有一屏告诉你怎么更新。
