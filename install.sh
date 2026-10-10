#!/bin/sh
# Installs workoffdesk on a Mac: tmux and Node from Homebrew, then the package from npm.
#   curl -fsSL https://raw.githubusercontent.com/workoffdesk/workoffdesk/main/install.sh | sh
set -eu

say() { printf '%s\n' "$*"; }

[ "$(uname)" = "Darwin" ] || { say "workoffdesk runs on macOS only."; exit 1; }
command -v brew >/dev/null 2>&1 || {
  say "Homebrew is needed first. Install it from https://brew.sh, then run this again:"
  # shellcheck disable=SC2016 # printed for the person to run, not expanded here
  say '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
}
command -v tmux >/dev/null 2>&1 || brew install tmux
command -v node >/dev/null 2>&1 || brew install node
npm i -g workoffdesk

# npm's global bin is not on every PATH (a prefix set in ~/.npmrc, a node manager in another shell).
bin="$(npm prefix -g)/bin"
case ":$PATH:" in
  *":$bin:"*) ;;
  *)
    say "workoffdesk is in $bin, which is not on your PATH. Add it:"
    say "  echo 'export PATH=\"$bin:\$PATH\"' >> ~/.zprofile"
    say ""
    ;;
esac

# Node too old, no Claude Code: doctor says so, with what to do.
"$bin/workoffdesk" doctor || true
say ""

# Run from a terminal with nothing set up yet, setup goes on in the browser: account, address, service.
if [ -t 1 ] && [ ! -f "${WORKOFFDESK_HOME:-$HOME/.workoffdesk}/config.json" ]; then
  exec "$bin/workoffdesk" setup --web
fi
say "Next, set it up in the browser:"
say "  workoffdesk setup --web"
say "or in the terminal: tell it the HTTPS address your phone will open,"
say "  workoffdesk setup --origin https://workoffdesk.example.com"
say "then make it a service that starts at login:"
say "  workoffdesk install"
