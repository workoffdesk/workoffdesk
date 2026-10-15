#!/bin/bash
# Builds the app in Release for the iOS Simulator, unsigned for a device, into <dest> (a WorkOffDesk.app).
#
#   ./scripts/build-sim-app.sh <dest>
#
# The README's demo GIF is recorded from it (apps/server/tests/e2e/demo/make.sh). The derived data, several
# gigabytes, goes next to <dest> and is removed once the app is copied out.

set -euo pipefail
DEST="${1:?usage: build-sim-app.sh <dest>}"
cd "$(dirname "$0")/.."
ROOT=$(pwd)
mkdir -p "$(dirname "$DEST")"
DERIVED="$(cd "$(dirname "$DEST")" && pwd)/derived-data"

echo "==> expo prebuild"
npx expo prebuild -p ios >/dev/null

# A Release build leaves the release prebuilts in Pods; the debug ones go back however this ends.
done_building() {
  local status=$?
  rm -rf "$DERIVED"
  "$ROOT/scripts/restore-debug-prebuilts.sh" || echo "the debug prebuilts are not back; run scripts/restore-debug-prebuilts.sh" >&2
  exit "$status"
}
trap done_building EXIT

echo "==> build for the Simulator"
LOG="$(dirname "$DEST")/build-sim-app.log"
nice -n 10 xcodebuild build \
  -workspace ios/WorkOffDesk.xcworkspace \
  -scheme WorkOffDesk \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_IDENTITY=- \
  > "$LOG" 2>&1 \
  || { echo "build failed, see $LOG" >&2; grep -E "error:" "$LOG" | sort -u | head -20 >&2; exit 1; }

rm -rf "$DEST"
cp -R "$DERIVED/Build/Products/Release-iphonesimulator/WorkOffDesk.app" "$DEST"
echo "    app: $DEST"
