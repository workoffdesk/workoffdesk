# 升级

[English](upgrade.md) · 简体中文

## 简单的办法

用 npm 或 `install.sh` 装的：

```bash
npm i -g workoffdesk@latest
launchctl kickstart -k gui/$(id -u)/local.workoffdesk
workoffdesk doctor
```

重启时会话照样在跑。服务如果还在跑旧版本,`doctor` 的 `service` 一项会不过。如果顺便升级了 Node,要再跑一次
`workoffdesk install`(或者带上 `--node <路径>`):服务用的是执行 `install` 的那个 Node。

## 会自检的升级

想让升级先试过新版本再切过去，而且能回退，就让服务从它 home 里的构建目录跑，而不是从 npm 的目录跑。只需一次：

```bash
npm pack workoffdesk@latest                      # 得到 workoffdesk-<版本>.tgz
mkdir -p ~/.workoffdesk && tar -xzf workoffdesk-<版本>.tgz -C ~/.workoffdesk
mv ~/.workoffdesk/package ~/.workoffdesk/app
(cd ~/.workoffdesk/app && npm install --omit=dev)
node ~/.workoffdesk/app/dist/server/cli.js install
```

之后服务和 `workoffdesk` 命令都从 `~/.workoffdesk/app` 启动。以后每次用同样的办法做一个构建目录(解开的包，
装好生产依赖，放哪都行)，然后：

```bash
workoffdesk deploy <构建目录>
workoffdesk rollback
```

`deploy` 会：

1. `dist` 不是按 `package.json` 里那个版本构建的，什么都不动直接拒绝;
2. 复制进 `~/.workoffdesk/releases/`,用一个临时 home 跑这个版本自带的冒烟测试;不过就不切换;
3. 把 `app` 指过去，重启服务;
4. 30 秒内 `/healthz` 报不出新版本号，自动切回去。

保留最新的三个版本。`rollback` 切回当前版本的前一个。
