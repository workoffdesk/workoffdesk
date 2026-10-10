# Security

## What you are putting on the internet

workoffdesk is a remote terminal. **Whoever signs in can run anything your macOS user can run**: read your
files, use your SSH keys and cloud credentials, start Claude Code with your account. Treat the password
like your login password and the site like an SSH port.

## What it does to keep others out

- **One user.** There is exactly one account per install, made with `workoffdesk setup`. Running `setup`
  again replaces the password and signs every device out.
- **Password and passkeys.** Passwords (12 characters or more) are stored as scrypt hashes. After signing in
  you can add passkeys (WebAuthn, e.g. Face ID) and sign in with those instead.
- **Lockout.** Five failed sign-ins from one address within 15 minutes lock that address for 15 minutes;
  twenty failures from anywhere within an hour lock sign-in for everyone for an hour. Every attempt is
  written to `logs/audit.log`.
- **Sessions you can revoke.** A sign-in lasts 30 days. Each signed-in device is listed in Settings and can
  be revoked; it is sent back to the sign-in page on its next request.
- **Origin checks.** Requests that change anything, and every WebSocket, must come from the configured
  `origin`; anything else is refused.
- **Content Security Policy.** Pages load scripts, styles and images only from the site itself; images
  from the web inside Claude's replies are shown as links, never loaded.
- **Loopback only.** The server listens on `127.0.0.1` and does not trust `X-Forwarded-*` headers.

## Who can read your traffic

The path between your phone and the Mac decides who else sees what you type and what Claude answers. See
[Remote access](docs/guide/remote-access.md).

- **Tailscale** (`tailscale serve`): TLS ends on your Mac; only your own devices take part.
- **A Cloudflare Tunnel**: Cloudflare terminates TLS at its edge, so Cloudflare can read the traffic.
- **Your own server** with a reverse proxy: that server terminates TLS and can read the traffic.

## How to run it safely

- **Always serve it over HTTPS.** Never expose the port directly or forward it on your router: cookies are
  `Secure` and passkeys need HTTPS, and a plain-HTTP site sends your password in the clear.
- Choose a long password, add a passkey, and revoke devices you no longer use.
- An access layer in front, such as a VPN or Tailscale, adds a second lock: only your devices can reach the
  sign-in page at all.
- **`claudeArgs` widens what a session does without you.** `--dangerously-skip-permissions` lets Claude run
  any command and edit any file without asking; combined with remote access, a prompt injection in
  something Claude reads can act on your Mac while you are away. Add it only if you accept that.

## Reporting a vulnerability

Report it privately through the repository's
[security advisories](https://github.com/workoffdesk/workoffdesk/security/advisories/new). Please do not open a
public issue for anything that lets someone sign in, read files or run commands without the password.
