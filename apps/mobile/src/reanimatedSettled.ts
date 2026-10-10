// Reanimated 4.5 hands an animated style back to React once it has rested a second, from a JS timer that first
// drops, without handing back, whatever rested over two seconds (AnimatedPropsRegistry::getUpdatesOlderThanTimestamp).
// A JS thread busy for over a second loses the hand-off, and the next render puts the view back where its style was
// when it mounted: the composer, mounted with a keyboard still up, stays a keyboard's height up with none.
// Without the timer, the native registry keeps a view's last animated value until the view is gone.
// The build's own switch is the static flag FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS (package.json), which
// changes the runtime: set it to false with the next native build, and remove this.

// The module the library's own components import (its source, which Metro resolves for React Native); its types are
// not checked under this app's settings, so only the one method is named here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PropsRegistryGarbageCollector } = require('react-native-reanimated/src/PropsRegistryGarbageCollector') as {
  PropsRegistryGarbageCollector: { registerInterval: () => void };
};

PropsRegistryGarbageCollector.registerInterval = () => {};
