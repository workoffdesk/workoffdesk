# Upgrade

English · [简体中文](upgrade.zh-CN.md)

## The simple way

Installed with npm or `install.sh`:

```bash
npm i -g workoffdesk@latest
launchctl kickstart -k gui/$(id -u)/local.workoffdesk
workoffdesk doctor
```

Sessions keep running through the restart. `doctor` fails the `service` check if the service still runs the
old version. If you upgraded Node too, run `workoffdesk install` again (or with `--node <path>`): the service
runs on the Node that ran `install`.

## Upgrades that check themselves

For upgrades that test the new build before switching to it and can be undone, run the service from a build
folder in its home instead of from npm's. Once:

```bash
npm pack workoffdesk@latest                      # workoffdesk-<version>.tgz
mkdir -p ~/.workoffdesk && tar -xzf workoffdesk-<version>.tgz -C ~/.workoffdesk
mv ~/.workoffdesk/package ~/.workoffdesk/app
(cd ~/.workoffdesk/app && npm install --omit=dev)
node ~/.workoffdesk/app/dist/server/cli.js install
```

The service and the `workoffdesk` command now start from `~/.workoffdesk/app`. From then on, make a build
folder the same way (an unpacked package with its production dependencies, anywhere) and:

```bash
workoffdesk deploy <build folder>
workoffdesk rollback
```

`deploy`:

1. refuses a build whose `dist` was not built for the version in its `package.json`, before touching anything;
2. copies it into `~/.workoffdesk/releases/` and runs the build's own smoke test against a throwaway home; a
   build that fails it is never switched to;
3. points `app` at it and restarts the service;
4. switches back on its own if the service does not report the new version on `/healthz` within 30 seconds.

The newest three releases are kept. `rollback` switches to the release before the current one.
