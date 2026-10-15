#!/bin/sh
# The README's demo GIFs, in English and Chinese: docs/screens/demo*.gif and how-it-works*.gif.
# The demo is recorded from the iPhone app in the iOS Simulator, built here first (about 15 minutes and 8 GB
# while it builds). Needs Xcode with an iOS Simulator runtime, Maestro (maestro.dev; MAESTRO names it when it is
# not ~/.maestro/bin/maestro), ffmpeg and Python 3 with Pillow. Run with `pnpm --filter workoffdesk demo`.
set -e
cd "$(dirname "$0")"
SCREENS=../../../../../docs/screens
FPS=12

# render <stage dir> <gif> <width>: stage PNGs -> a GIF with its own palette.
render() {
  ffmpeg -loglevel error -y -framerate $FPS -i "$1/%04d.png" -vf "scale=$3:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" "$1.palette.png"
  ffmpeg -loglevel error -y -framerate $FPS -i "$1/%04d.png" -i "$1.palette.png" -lavfi "scale=$3:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" -loop 0 "$2"
}

../../../../mobile/scripts/build-sim-app.sh "$(pwd)/out/WorkOffDesk.app"
npx playwright test -c playwright.config.ts
rm -rf out/WorkOffDesk.app
for lang in en zh-CN; do
  suffix=$([ $lang = en ] && echo '' || echo ".$lang")
  python3 compose.py out $lang out/stage-$lang
  render out/stage-$lang $SCREENS/demo$suffix.gif 540
  node arch.mjs $lang out/arch-$lang
  render out/arch-$lang $SCREENS/how-it-works$suffix.gif 960
done
ls -la $SCREENS/demo*.gif $SCREENS/how-it-works*.gif
