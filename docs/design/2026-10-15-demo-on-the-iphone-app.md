# The README's demo, recorded on the iPhone app

The demo GIF at the top of the READMEs was recorded from the web app in a phone-sized browser. It is now recorded
from the iPhone app in the iOS Simulator, against the same test server and the same scripted Claude, and still by
`pnpm --filter workoffdesk demo` alone.

## What holds

- The GIF is made by the command, never by hand: the app is built from this checkout, and a run makes both
  languages from nothing but the repository and the tools it names.
- Only what the command makes changes: the Simulator device it makes and the app it builds are gone when it ends,
  however it ends; the iOS project's prebuilt frameworks are back in their debug flavour, as `release-ios.sh`
  leaves them; the server, tmux and home are the test server's own.
- The story, the captions and the frame around the phone stay as they are, so the two languages and the
  architecture GIF still match.

## Who already knows

- `tests/e2e/demo/record.ts` plays the scripted Claude (transcript rows and hook calls) on the test server that
  `playwright.config.ts` starts, and writes the frames, their times and the caption marks that `compose.py` turns
  into the GIF's stage. Nothing after the frames knows where they came from.
- `compose.py` draws its own status bar and home indicator around the app's part of the screen, the part between
  the 54-point status bar and the 34-point home indicator of a 440x956-point phone. The iPhone 17 Pro Max has that
  screen.
- Maestro drives the Simulator from outside the app, by what is on screen, without a window in front.
- `apps/mobile/scripts/release-ios.sh` already knows how this checkout's app is prebuilt and built in Release.

## Design

- `apps/mobile/scripts/build-sim-app.sh <dest>` builds the app in Release for the Simulator (prebuild, then
  `xcodebuild` into a derived-data folder under `<dest>`'s folder), copies `WorkOffDesk.app` to `<dest>`, removes
  the derived data, and puts the debug prebuilts back on its way out.
- `record.ts` keeps the server side as it is and drives the app instead of a page:
  - makes a Simulator device (iPhone 17 Pro Max, in the run's language, dark), installs the app, and signs in with
    a Maestro flow (`signin.yaml`) before anything is recorded;
  - records the Simulator's screen while a second flow (`story.yaml`) plays the story. The flow asks the test for
    its pauses and marks over a small local HTTP server (`/wait/<ms>`, `/cap/<n>`, `/end`), so the timing is
    the test's, as it was with the page;
  - the frames are the video's, cut to the app's part of the screen, at 15 a second, with times from the first
    caption;
  - the device is deleted whatever happens.
- `make.sh` builds the app once into `out/`, runs the recording for both languages, and composes and renders as
  before.

## Not in this

- The screenshots under the GIF (`screens.spec.ts`) stay those of the web app.
- No CI run: building the app takes minutes and several gigabytes, as recording the GIF always has on a Mac.
