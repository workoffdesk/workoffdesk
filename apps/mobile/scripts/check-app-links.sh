#!/bin/bash
# Every @rpath library that the app or one of its frameworks loads must be inside the app's Frameworks
# folder; a missing one makes iOS kill the app at launch, before any of our code runs.
#
#   ./scripts/check-app-links.sh path/to/WorkOffDesk.app
set -euo pipefail
APP="${1:?usage: check-app-links.sh path/to/App.app}"
[ -d "$APP" ] || { echo "no app at $APP" >&2; exit 1; }
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")

binaries=("$APP/$EXE")
for fw in "$APP"/Frameworks/*.framework; do
  [ -e "$fw" ] && binaries+=("$fw/$(basename "$fw" .framework)")
done

missing=0
for bin in "${binaries[@]}"; do
  while read -r lib; do
    [ -e "$APP/Frameworks/${lib#@rpath/}" ] && continue
    echo "missing: ${bin#"$APP"/} loads $lib, which is not in Frameworks/" >&2
    missing=1
  done < <(otool -L "$bin" | awk 'NR > 1 && $1 ~ /^@rpath\// { print $1 }')
done
[ "$missing" = 0 ] && echo "    links: ${#binaries[@]} binaries, every @rpath library present"
exit "$missing"
