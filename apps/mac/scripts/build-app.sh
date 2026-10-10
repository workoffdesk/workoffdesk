#!/bin/sh
# Builds WorkOffDesk.app, the menu bar app, into apps/mac/build: an agent with no Dock icon, signed ad hoc,
# which runs on this Mac. Handing it to others needs a Developer ID signature and notarization.
set -eu

here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../server/package.json")"
app="$here/build/WorkOffDesk.app"

swift build --package-path "$here" -c release --product WorkOffDeskMenu
bin="$(swift build --package-path "$here" -c release --show-bin-path)/WorkOffDeskMenu"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/WorkOffDeskMenu"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>WorkOffDeskMenu</string>
  <key>CFBundleIdentifier</key>
  <string>local.workoffdesk.menubar</string>
  <key>CFBundleName</key>
  <string>WorkOffDesk</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$version</string>
  <key>CFBundleVersion</key>
  <string>$version</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null
codesign --force --sign - "$app"
codesign --verify "$app"
echo "$app"
