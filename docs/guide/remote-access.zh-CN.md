# 外网访问

[English](remote-access.md) · 简体中文

服务只监听 `127.0.0.1:7681`。要在手机上用，得在它前面放一个东西：用 HTTPS 提供你的地址，再把请求(包括
WebSocket)转到这个端口。你选的地址，就是传给 `setup` 的 `--origin`。

## 选哪种

关键问题是谁能读到你的流量——里面走的是你的终端。

| | 谁能读到流量 | 手机上要装什么 | 要不要自己的域名 | 在哪能用 |
|---|---|---|---|---|
| [Tailscale](#tailscale) | 只有你自己的设备;TLS 在你的 Mac 上解开 | Tailscale App,并登录 | 不要 | 任何网络 |
| [Cloudflare Tunnel](#cloudflare-tunnel) | 还有 Cloudflare;TLS 在它的边缘节点解开 | 不用装 | 要([没有也能先试](#没有域名只想试一下)) | 任何网络 |
| [自己的服务器](#自己的服务器) | 还有你的服务器;TLS 在那里解开 | 不用装 | 要 | 任何网络 |

Tailscale 最私密，也不需要自己的域名：地址是 Tailscale 给的。Cloudflare Tunnel 手机上什么都不用装，代价是
Cloudflare 能看到经过它的内容。

## Tailscale

1. 在 Mac 和手机上都装 Tailscale,登录同一个 tailnet。在它的管理后台给这个 tailnet 打开 HTTPS 证书。
2. 在 Mac 上：

   ```bash
   tailscale serve --bg 7681
   ```

   它会打印地址 `https://<机器名>.<tailnet>.ts.net`。`tailscale serve reset` 关掉。
3. 用这个地址做 origin:`workoffdesk setup --origin https://<机器名>.<tailnet>.ts.net`。

只有你 tailnet 里的设备(以及你分享这台机器给的人)能打开。Tailscale 的文档没写 `serve` 是否转发
WebSocket;如果页面能打开、但会话一直连不上，请提一个 issue。

## Cloudflare Tunnel

需要一个托管在 Cloudflare 上的域名。

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create workoffdesk
workoffdesk setup --origin https://workoffdesk.example.com    # 你 Cloudflare 域名下的一个主机名
workoffdesk install --tunnel workoffdesk
```

`install --tunnel` 会写 `~/.workoffdesk/cloudflared.yml` 和第二个 launchd agent `local.workoffdesk-tunnel`,
并打印要执行的命令：给你的主机名配 DNS 路由，以及每个 agent 一条 `launchctl bootstrap`。它不会碰
`~/.cloudflared/config.yml`。隧道只往外连，你的网络上不会打开任何端口。它的日志在
`~/.workoffdesk/logs/tunnel.log`。

Cloudflare 在它的边缘节点解开 TLS,所以 Cloudflare 能读到流量。

### 没有域名，只想试一下

`cloudflared` 可以开一个临时隧道，不要域名，也不要 Cloudflare 账号:

```bash
cloudflared tunnel --url http://127.0.0.1:7681
```

它会打印一个地址 `https://<几个随机单词>.trycloudflare.com`,可能要等一分钟左右才打得开。用它做 origin:
`workoffdesk setup --origin https://<几个随机单词>.trycloudflare.com`,再 `workoffdesk restart` 让服务用上它。

它只适合试一下，不适合天天用:

- 这条命令每启动一次就换一个地址;每换一个地址都要重新 `setup --origin`,会再问一遍密码、所有设备都被登出，
  给旧地址建的 Passkey 也不能用了。
- 隧道只在这条命令运行时才有;Mac 重启后没有东西会把它再拉起来。
- 有 `~/.cloudflared/config.yml` 时,`cloudflared` 会照那里的规则走，这个地址只会回 404。让它读一个空文件:
  `touch /tmp/empty.yml`,再加 `--config /tmp/empty.yml`。
- 如果日志一直出现 `failed to dial to edge with quic`(VPN 或代理可能拦住了 QUIC),加 `--protocol http2`。

## 自己的服务器

如果你已经有一台带域名的服务器，可以让它来转。连接由 Mac 主动发起，你的网络上不用打开任何东西：

```bash
# 在 Mac 上，让它一直开着(比如用 autossh)
ssh -N -R 7681:127.0.0.1:7681 you@your-server
```

```caddyfile
# 在服务器上,Caddyfile
workoffdesk.example.com {
    reverse_proxy 127.0.0.1:7681 {
        header_up CF-Connecting-IP {remote_host}
    }
}
```

Caddy 会自己申请证书，也会转发 WebSocket。用 nginx 的话，要转发 `Upgrade` 和 `Connection` 两个请求头。
TLS 在服务器上解开，所以能控制这台服务器的人能读到流量。

服务从 `CF-Connecting-IP` 取访问者的地址，用来锁定反复登录失败的来源，所以这个请求头要由代理自己设置;
要是原样转发访问者发来的，对方每试一次就能换一个地址。

想保留已有的地址(比如 Cloudflare 隧道)、再加上这一个，把它写进 [config.json](configuration.zh-CN.md#configjson)
的 `extraOrigins`,然后重启服务。

## 千万别做的事

- **别让服务监听别的地址。** 它只监听 `127.0.0.1` 是故意的。
- **别在路由器上做端口转发**到这台 Mac。那样互联网上任何人都能直接打到登录页，绕过上面所有方式。
- **除了 `localhost`,别用纯 HTTP。** 密码和登录 cookie 会明文过网络;而且浏览器只在 HTTPS 下允许
  Passkey 和推送通知。
