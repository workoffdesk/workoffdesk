#!/bin/bash
# Puts the debug flavour of every prebuilt framework back into Pods, where `pod install` takes it to be.
# A Release archive swaps the release ones in; release-ios.sh runs this on its way out. Run it by hand when
# a simulator build crashes at launch in Props::Props or fails to link: the Pods then hold release
# frameworks their markers call debug.
#
# It runs Xcode's own swap phases from the Pods project as a Debug build would, after marking every flavour
# as not debug so each is extracted again, then checks each simulator binary against its debug tarball.

set -euo pipefail
cd "$(dirname "$0")/.."
PODS="$(pwd)/ios/Pods"
[ -f "$PODS/Pods.xcodeproj/project.pbxproj" ] || exit 0

REACT_NATIVE_PATH=$(dirname "$(node -p "require.resolve('react-native/package.json')")")
NODE_BINARY=$(command -v node)
export PODS_ROOT="$PODS" REACT_NATIVE_PATH NODE_BINARY GCC_PREPROCESSOR_DEFINITIONS='COCOAPODS=1 DEBUG=1'

[ ! -d "$PODS/React-Core-prebuilt" ] || printf Release > "$PODS/React-Core-prebuilt/.last_build_configuration"
for artifacts in "$PODS"/*/artifacts; do
  [ -d "$artifacts" ] || continue
  printf release > "$artifacts/.last_build_configuration"
  rm -f "$artifacts"/*.last_config
done

phases=$(plutil -convert json -o - "$PODS/Pods.xcodeproj/project.pbxproj" | node -e '
  const objects = JSON.parse(require("fs").readFileSync(0, "utf8")).objects;
  const swaps = Object.values(objects).filter((o) => o.isa === "PBXShellScriptBuildPhase" && /replace-(xcframework|rncore-version)\.js/.test(o.shellScript));
  process.stdout.write(JSON.stringify(swaps.map((o) => o.shellScript)));')
count=$(node -pe 'JSON.parse(process.argv[1]).length' "$phases")
[ "$count" -gt 0 ] || { echo "no prebuilt swap phases in the Pods project" >&2; exit 1; }
for i in $(seq 0 $((count - 1))); do
  (cd "$PODS" && bash -c "$(node -pe 'JSON.parse(process.argv[1])[process.argv[2]]' "$phases" "$i")") >/dev/null
done

bad=0
SIM=ios-arm64_x86_64-simulator
same() { # <tarball> <member> <file on disk>
  [ "$(tar -xOf "$1" "$2" | shasum | cut -c1-40)" = "$(shasum < "$3" | cut -c1-40)" ] \
    || { echo "not the debug build: $3" >&2; bad=1; }
}
for tarball in "$PODS"/ReactNativeCore-artifacts/reactnative-core-*-debug.tar.gz; do
  [ ! -f "$tarball" ] || same "$tarball" "React.xcframework/$SIM/React.framework/React" "$PODS/React-Core-prebuilt/React.xcframework/$SIM/React.framework/React"
done
for tarball in "$PODS"/*/artifacts/*-debug.tar.gz; do
  [ -f "$tarball" ] || continue
  m=$(basename "$tarball" -debug.tar.gz)
  same "$tarball" "$m.xcframework/$SIM/$m.framework/$m" "$(dirname "$(dirname "$tarball")")/$m.xcframework/$SIM/$m.framework/$m"
done
for link in "$PODS"/*/*.xcframework; do
  [ -L "$link" ] || continue
  case "$(readlink "$link")" in */debug/*) ;; *) echo "not the debug build: $link" >&2; bad=1 ;; esac
done
[ "$bad" = 1 ] || echo "Pods hold the debug prebuilts"
exit "$bad"
