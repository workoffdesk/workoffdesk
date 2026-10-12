# Remote access

English · [简体中文](remote-access.zh-CN.md)

The service listens on `127.0.0.1:7681` only. To use it from your phone, put something in front of it that
serves your address over HTTPS and forwards it, WebSockets included, to that port. The address you choose is
the `--origin` you give `setup`.

## Which one

The question that matters is who can read your traffic: it carries your terminal.

| | Who can read the traffic | Phone needs | Your own domain | Works from |
|---|---|---|---|---|
| [Tailscale](#tailscale) | Only your devices; TLS ends on your Mac | The Tailscale app, signed in | Not needed | Any network |
| [Cloudflare Tunnel](#cloudflare-tunnel) | Cloudflare too; TLS ends at its edge | Nothing | Needed ([to try it without one](#without-a-domain-to-try-it)) | Any network |
| [Your own server](#your-own-server) | Your server too; TLS ends there | Nothing | Needed | Any network |

Tailscale is the private choice, and needs no domain of your own: the address is Tailscale's. A Cloudflare
Tunnel needs nothing on the phone, at the price of Cloudflare seeing what passes through it.

## Tailscale

1. Install Tailscale on the Mac and the phone, and sign both in to the same tailnet. Turn on HTTPS
   certificates for the tailnet in its admin console.
2. On the Mac:

   ```bash
   tailscale serve --bg 7681
   ```

   It prints the address, `https://<machine>.<tailnet>.ts.net`. `tailscale serve reset` turns it off.
3. Use that address as the origin: `workoffdesk setup --origin https://<machine>.<tailnet>.ts.net`.

Only devices in your tailnet (and people you share the machine with) can open it. Tailscale's documentation
does not say whether `serve` passes WebSockets through; if the page opens but no session ever connects,
please open an issue.

## Cloudflare Tunnel

You need a domain on Cloudflare.

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create workoffdesk
workoffdesk setup --origin https://workoffdesk.example.com    # a hostname in your Cloudflare zone
workoffdesk install --tunnel workoffdesk
```

`install --tunnel` writes `~/.workoffdesk/cloudflared.yml` and a second launchd agent,
`local.workoffdesk-tunnel`, and prints the commands to run: the DNS route for your hostname and a
`launchctl bootstrap` for each agent. It never touches `~/.cloudflared/config.yml`. The tunnel only makes
outbound connections, so no port is opened on your network. Its log is `~/.workoffdesk/logs/tunnel.log`.

Cloudflare terminates TLS at its edge, so Cloudflare can read the traffic.

### Without a domain, to try it

`cloudflared` can open a quick tunnel without a domain or a Cloudflare account:

```bash
cloudflared tunnel --url http://127.0.0.1:7681
```

It prints an address, `https://<random words>.trycloudflare.com`, which may take a minute to open. Use it as
the origin, `workoffdesk setup --origin https://<random words>.trycloudflare.com`, then `workoffdesk restart`
so the service takes it.

It is for trying, not for every day:

- Each start of that command gives a new address, and each new address means `setup --origin` again, which
  asks for the password again and signs every device out. Passkeys made for the old address no longer work.
- The tunnel runs only while that command does; nothing starts it again after a restart of the Mac.
- When `~/.cloudflared/config.yml` is there, `cloudflared` follows its rules instead, and the address answers
  404. Point it at an empty file: `touch /tmp/empty.yml` and add `--config /tmp/empty.yml`.
- If it keeps logging `failed to dial to edge with quic` (a VPN or proxy can block QUIC), add
  `--protocol http2`.

## Your own server

If you already run a server with a domain, it can carry the traffic. The Mac opens the connection to it, so
nothing on your network is opened:

```bash
# on the Mac: keep this running (for example with autossh)
ssh -N -R 7681:127.0.0.1:7681 you@your-server
```

```caddyfile
# on the server, Caddyfile
workoffdesk.example.com {
    reverse_proxy 127.0.0.1:7681 {
        header_up CF-Connecting-IP {remote_host}
    }
}
```

Caddy gets the certificate and passes WebSockets through. With nginx, forward the `Upgrade` and
`Connection` headers. The server terminates TLS, so whoever controls it can read the traffic.

The service takes the visitor's address from `CF-Connecting-IP` to lock out repeated failed sign-ins, so the
proxy sets that header itself; passed through from the visitor, it would let them pick a new address for
each try.

To keep an address you already have, such as a Cloudflare tunnel, and add this one beside it, list it in
`extraOrigins` in [config.json](configuration.md#configjson) and restart the service.

## What not to do

- **Do not make the service listen on another address.** It listens on `127.0.0.1` on purpose.
- **Do not forward a port on your router** to the Mac. Anyone on the internet could then reach the sign-in
  page directly, past any of the options above.
- **Do not use plain HTTP** beyond `localhost`. The password and sign-in cookie would cross the network
  readable, and browsers allow passkeys and push notifications only on HTTPS.
