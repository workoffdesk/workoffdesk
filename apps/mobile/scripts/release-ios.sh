#!/bin/bash
# Build, sign and upload the iPhone app to App Store Connect, from where it reaches TestFlight.
#
#   ./scripts/release-ios.sh               prebuild + archive + export + upload
#   ./scripts/release-ios.sh --no-upload   stop after producing the .ipa
#   ./scripts/release-ios.sh --clean       regenerate ios/ from scratch (after removing a native module or plugin)
#
# The version and build number come from app.config.ts (version / ios.buildNumber); bump the build
# number before each upload.
# You sign with your own Apple Developer account:
#   WORKOFFDESK_TEAM_ID         your Team ID (developer.apple.com → Membership)
#   WORKOFFDESK_IOS_BUNDLE_ID   the app's bundle id, the one your push key is for
#   ASC_KEY_ID, ASC_ISSUER_ID   an App Store Connect API key with the Admin role, which automatic signing needs
#   ASC_KEY_PATH                its .p8 file (default ~/.appstoreconnect/private_keys/AuthKey_<id>.p8)
#   WORKOFFDESK_KEYCHAIN        optional: a keychain holding the Apple Distribution certificate, unlocked
#   WORKOFFDESK_KEYCHAIN_PASS   with this password; without it the login keychain is used
#
# Before uploading, mind the server. A phone signed in to a server runs that server's JS, not this binary's:
# - Same runtime as the build on phones (the line `runtime:` below prints it): the phone keeps running the
#   update it last took from its server, and never this build's embedded JS. Deploy the server built from
#   the same commit (its dist/app-update) with or before this upload, or the build's JS changes reach no one.
# - New runtime: phones run this build's embedded JS (an expo-updates "emergency launch", logged as
#   "No launchable updates found in database") until their server is deployed with an update for it.
# In the server's log, an `app update check` line with `running: null` is such a phone: no update from this
# server for its runtime yet.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

SCHEME=WorkOffDesk
TEAM_ID="${WORKOFFDESK_TEAM_ID:?set WORKOFFDESK_TEAM_ID to your Apple Developer Team ID (developer.apple.com → Membership)}"
: "${WORKOFFDESK_IOS_BUNDLE_ID:?set WORKOFFDESK_IOS_BUNDLE_ID to the app bundle id, the one your push key is for}"
KEY_ID="${ASC_KEY_ID:?set ASC_KEY_ID to your App Store Connect API key id}"
ISSUER_ID="${ASC_ISSUER_ID:?set ASC_ISSUER_ID to your App Store Connect API issuer id}"
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8}"
KEYCHAIN="${WORKOFFDESK_KEYCHAIN:-}"

UPLOAD=1; CLEAN=()
for arg in "$@"; do
  [ "$arg" = "--no-upload" ] && UPLOAD=0
  [ "$arg" = "--clean" ] && CLEAN=(--clean)
done

[ -f "$KEY_PATH" ] || { echo "missing App Store Connect key at $KEY_PATH" >&2; exit 1; }
[ -z "$KEYCHAIN" ] || [ -f "$KEYCHAIN" ] || { echo "missing signing keychain at $KEYCHAIN" >&2; exit 1; }

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null
fi
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' \
  || { echo "node 22.13 or later is needed, this is $(node --version)" >&2; exit 1; }

CONFIG=$(npx expo config --json --type public)
field() { node -pe 'const c = JSON.parse(process.argv[1]); process.argv[2].split(".").reduce((o, k) => o?.[k], c) ?? ""' "$CONFIG" "$1"; }
VERSION=$(field version)
BUILD=$(field ios.buildNumber)
BUNDLE_ID=$(field ios.bundleIdentifier)
case "$VERSION" in ''|*[!0-9.]*) echo "bad version '$VERSION'" >&2; exit 1;; esac
case "$BUILD"   in ''|*[!0-9]*)  echo "bad ios.buildNumber '$BUILD'" >&2; exit 1;; esac
echo "building $BUNDLE_ID $VERSION ($BUILD)"

# Without --clean, ios/ and its build cache are kept, so only what changed is compiled again.
echo "==> expo prebuild"
npx expo prebuild -p ios ${CLEAN[@]+"${CLEAN[@]}"} >/dev/null

OUT="$ROOT/ios/build/release"
rm -rf "$OUT" && mkdir -p "$OUT"
ARCHIVE="$OUT/WorkOffDesk-$VERSION-$BUILD.xcarchive"

cat > "$OUT/exportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>$TEAM_ID</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>uploadSymbols</key>
	<true/>
	<key>destination</key>
	<string>export</string>
</dict>
</plist>
PLIST

[ -z "$KEYCHAIN" ] || security unlock-keychain -p "${WORKOFFDESK_KEYCHAIN_PASS:?set WORKOFFDESK_KEYCHAIN_PASS to unlock $KEYCHAIN}" "$KEYCHAIN"

AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

# The archive leaves the release prebuilts in Pods; the debug ones go back however this ends.
restore_debug_prebuilts() {
  local status=$?
  "$ROOT/scripts/restore-debug-prebuilts.sh" || echo "the debug prebuilts are not back; run scripts/restore-debug-prebuilts.sh" >&2
  exit "$status"
}
trap restore_debug_prebuilts EXIT

echo "==> archive"
nice -n 10 xcodebuild archive \
  -workspace ios/WorkOffDesk.xcworkspace \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  "${AUTH[@]}" \
  > "$OUT/archive.log" 2>&1 \
  || { echo "archive failed, see $OUT/archive.log" >&2; grep -E "error:" "$OUT/archive.log" | sort -u | head -20 >&2; exit 1; }

PLIST_OF() { /usr/libexec/PlistBuddy -c "Print :ApplicationProperties:$1" "$ARCHIVE/Info.plist"; }
if [ "$(PLIST_OF CFBundleShortVersionString)" != "$VERSION" ] || [ "$(PLIST_OF CFBundleVersion)" != "$BUILD" ] \
  || [ "$(PLIST_OF CFBundleIdentifier)" != "$BUNDLE_ID" ]; then
  echo "archive is $(PLIST_OF CFBundleIdentifier) $(PLIST_OF CFBundleShortVersionString) ($(PLIST_OF CFBundleVersion)), expected $BUNDLE_ID $VERSION ($BUILD)" >&2
  exit 1
fi
echo "    archived: $ARCHIVE"
# CocoaPods quietly builds React Native from source when it cannot fetch the prebuilt core, and the
# precompiled Expo frameworks then load a React.framework the app does not carry.
"$ROOT/scripts/check-app-links.sh" "$ARCHIVE/Products/Applications/$SCHEME.app"
# The server offers its JS by the runtime it computes from this source; the binary must carry the same one,
# or no update ever reaches it.
STAMPED=$(cat "$ARCHIVE/Products/Applications/$SCHEME.app/EXUpdates.bundle/fingerprint" 2>/dev/null || true)
RUNTIME=$(npx expo-updates runtimeversion:resolve --platform ios | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).runtimeVersion ?? '')")
if [ -z "$STAMPED" ] || [ "$STAMPED" != "$RUNTIME" ]; then
  echo "the archive's runtime is '${STAMPED}', the source's '${RUNTIME}'; an over-the-air update would never reach it" >&2
  exit 1
fi
echo "    runtime: $RUNTIME"

echo "==> export"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/exportOptions.plist" \
  "${AUTH[@]}" \
  > "$OUT/export.log" 2>&1 \
  || { echo "export failed, see $OUT/export.log" >&2; grep -iE "error:" "$OUT/export.log" | sort -u | head >&2; exit 1; }

IPA=$(find "$OUT/export" -maxdepth 1 -name '*.ipa' | head -1)
echo "    ipa: $IPA ($(du -h "$IPA" | cut -f1))"

if [ "$UPLOAD" = "0" ]; then
  echo "done (upload skipped)"
  exit 0
fi

# altool looks the key up by id in ~/.appstoreconnect/private_keys.
mkdir -p ~/.appstoreconnect/private_keys
[ "$KEY_PATH" -ef ~/.appstoreconnect/private_keys/"AuthKey_${KEY_ID}.p8" ] || cp "$KEY_PATH" ~/.appstoreconnect/private_keys/

echo "==> upload"
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID" \
  > "$OUT/upload.log" 2>&1 \
  || { echo "upload failed, see $OUT/upload.log" >&2; tail -20 "$OUT/upload.log" >&2; exit 1; }

echo "uploaded $BUNDLE_ID $VERSION ($BUILD); App Store Connect takes 5-15 min to process it before TestFlight shows it"
