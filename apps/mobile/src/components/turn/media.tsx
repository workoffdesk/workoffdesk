import { coverUrl, goneText, imageSrc, type SentFile } from '@workoffdesk/client/chat/images';
import { t } from '@workoffdesk/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, signIn, usePicture } from '../../client';
import type { Source } from '../../pictures';
import { useTheme } from '../../theme';
import { playVideo } from '../VideoPlayer';
import { useStyles } from './styles';

// A picture the session names, read from the Mac with this login.
const sourceOf = (sessionId: string, path: string): Source => ({
  uri: (auth.current()?.server ?? '') + imageSrc(sessionId, path),
  headers: signIn(),
});

// A picture in the chat, opened full screen on a tap. read: Claude read it, so it was there once.
// onDropped: it is not there, and was only named, so there is nothing to show for it.
function Picture({ source, path, read, size, onOpen, onDropped }: { source: Source; path: string; read: boolean; size: number; onOpen: () => void; onDropped: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [load, again] = usePicture(source);
  const said = goneText(path, read);
  const dropped = load.state === 'gone' && said === null;
  useEffect(() => {
    if (dropped) onDropped();
  }, [dropped, onDropped]);
  const box = [s.picture, { width: size, height: size }];
  if (dropped) return null;
  if (load.state === 'gone')
    return (
      <View style={[box, s.pictureGone]}>
        <Text style={s.muted}>{said}</Text>
      </View>
    );
  if (load.state === 'failed')
    return (
      <Pressable style={[box, s.pictureGone]} accessibilityRole="button" onPress={again}>
        <Text style={[s.muted, s.pictureNote]}>{t.imageNotLoaded}</Text>
      </Pressable>
    );
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={t.viewImage} onPress={onOpen}>
      {load.state === 'shown' ? (
        <Image source={{ uri: load.uri }} style={box} />
      ) : (
        <View style={[box, s.pictureLoading]}>
          <ActivityIndicator color={c.muted} />
        </View>
      )}
    </Pressable>
  );
}

export const PICTURE_GAP = 6;
// A picture let go of this far up or down, or flicked, closes the viewer, as in Photos.

const SWIPE_CLOSE_OFFSET = 90;

const SWIPE_CLOSE_VELOCITY = 1.4;
// How far a drag goes before the black behind the picture has gone.

const SWIPE_FADE = 320;

const LEAVE_MS = 180;

// One picture of the viewer, with a spinner until it has come over the line, and a way to ask again if it
// never does: on black, a picture still coming looks the same as one that will not.
// Not zoomed in, it is dragged up or down by the page's own bounce (the way react-native-image-viewing does it
// without a gesture library): drag follows that offset, and a picture let go far enough or flicked leaves the
// way it went. Zoomed in, a drag moves around the picture.
function ViewerPage({ source, path, read, width, height, label, drag, onClose }: { source: Source; path: string; read: boolean; width: number; height: number; label: string; drag: Animated.Value; onClose: () => void }) {
  const s = useStyles();
  const [load, again] = usePicture(source);
  const leaving = useRef(false);
  const [away] = useState(() => new Animated.Value(0));
  const shrink = drag.interpolate({ inputRange: [-SWIPE_FADE, 0, SWIPE_FADE], outputRange: [0.8, 1, 0.8], extrapolate: 'clamp' });
  const leave = (down: boolean) => {
    leaving.current = true;
    Animated.parallel([
      Animated.timing(away, { toValue: down ? height : -height, duration: LEAVE_MS, useNativeDriver: true }),
      Animated.timing(drag, { toValue: down ? -SWIPE_FADE : SWIPE_FADE, duration: LEAVE_MS, useNativeDriver: true }),
    ]).start(onClose);
  };
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      alwaysBounceVertical
      directionalLockEnabled
      scrollEventThrottle={16}
      onScroll={({ nativeEvent: e }) => {
        if (!leaving.current && e.zoomScale <= 1) drag.setValue(e.contentOffset.y);
      }}
      onScrollEndDrag={({ nativeEvent: e }) => {
        if (leaving.current || e.zoomScale > 1) return;
        const y = e.contentOffset.y;
        const flick = e.velocity?.y ?? 0;
        if (Math.abs(y) > SWIPE_CLOSE_OFFSET || Math.abs(flick) > SWIPE_CLOSE_VELOCITY) leave(Math.abs(y) > 1 ? y < 0 : flick < 0);
      }}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Pressable style={{ width, height }} accessibilityLabel={t.close} onPress={onClose}>
        {load.state === 'shown' && (
          <Animated.View style={{ width, height, transform: [{ translateY: away }, { scale: shrink }] }}>
            <Image source={{ uri: load.uri }} style={{ width, height }} resizeMode="contain" accessibilityLabel={label} />
          </Animated.View>
        )}
      </Pressable>
      {load.state === 'loading' && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#fff" pointerEvents="none" />}
      {(load.state === 'failed' || load.state === 'gone') && (
        <View style={[StyleSheet.absoluteFill, s.viewerFailed]} pointerEvents="box-none">
          {load.state === 'failed' ? (
            <Pressable style={s.viewerRetry} accessibilityRole="button" onPress={again}>
              <Text style={s.viewerRetryText}>{t.imageNotLoaded}</Text>
            </Pressable>
          ) : (
            <View style={s.viewerRetry}>
              <Text style={s.viewerRetryText}>{goneText(path, read) ?? path}</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

// Pictures full screen on black, starting from the one tapped: swiped through sideways, pinched to zoom,
// closed with the button, a tap, or a swipe up or down that fades the black as it goes.
export function Viewer({ sources, paths, read, start, onClose }: { sources: Source[]; paths: string[]; read: boolean; start: number; onClose: () => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<{ width: number; height: number } | null>(null);
  const [at, setAt] = useState(start);
  // How far the picture shown is dragged up (+) or down (-).
  const [drag] = useState(() => new Animated.Value(0));
  const black = drag.interpolate({ inputRange: [-SWIPE_FADE, 0, SWIPE_FADE], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const bar = drag.interpolate({ inputRange: [-SWIPE_CLOSE_OFFSET, 0, SWIPE_CLOSE_OFFSET], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[s.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Animated.View style={[StyleSheet.absoluteFill, s.viewerBlack, { opacity: black }]} pointerEvents="none" />
        {/* Above the pictures, not over them, so a picture of a screen is not taken for the screen. */}
        <Animated.View style={[s.viewerBar, { opacity: bar }]}>
          <View style={s.viewerSide} />
          <Text style={s.viewerCount}>{sources.length > 1 ? `${t.image} ${at + 1} / ${sources.length}` : t.image}</Text>
          <View style={s.viewerSide}>
            <Pressable style={s.viewerClose} accessibilityRole="button" accessibilityLabel={t.close} hitSlop={10} onPress={onClose}>
              <SymbolView name="xmark" tintColor="#fff" size={18} weight="semibold" />
            </Pressable>
          </View>
        </Animated.View>
        <View style={s.viewerPages} onLayout={(e) => setPage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          {page && (
            <ScrollView
              key={page.width}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: at * page.width, y: 0 }}
              onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / page.width))}
            >
              {sources.map((source, i) => (
                <ViewerPage key={source.uri} source={source} path={paths[i]} read={read} width={page.width} height={page.height} label={`${i + 1} / ${sources.length}`} drag={drag} onClose={onClose} />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Squares sent together as one block: full rows of them, two across for two or four, three across for more.
function gridOf(count: number, width: number) {
  const across = count === 1 ? 1 : count === 2 || count === 4 ? 2 : 3;
  const block = Math.min(width * 0.72, 300);
  return { across, size: across === 1 ? Math.min(block, 200) : Math.floor((block - PICTURE_GAP * (across - 1)) / across) };
}

// Pictures sent together as one block: full rows of equal squares, two across for two or four, three across
// for more, so no row is left with one hanging under the others. A tap opens them full screen, through the
// ones shown when it was tapped. read: Claude read them, so they were there once.
export function Pictures({ sessionId, paths: named, mine, read = false }: { sessionId: string; paths: string[]; mine?: boolean; read?: boolean }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<{ start: number; paths: string[] } | null>(null);
  const drop = useCallback((path: string) => setDropped((d) => (d.has(path) ? d : new Set(d).add(path))), []);
  const paths = named.filter((p) => !dropped.has(p));
  if (!paths.length) return null;
  const sources = paths.map((p) => sourceOf(sessionId, p));
  const { across, size } = gridOf(paths.length, width);
  return (
    <View style={[s.pictures, { width: across * size + PICTURE_GAP * (across - 1) }, mine ? s.end : s.start]}>
      {paths.map((p, i) => (
        <Picture key={p} source={sources[i]} path={p} read={read} size={size} onOpen={() => setOpen({ start: i, paths })} onDropped={() => drop(p)} />
      ))}
      {open && <Viewer sources={open.paths.map((p) => sourceOf(sessionId, p))} paths={open.paths} read={read} start={open.start} onClose={() => setOpen(null)} />}
    </View>
  );
}

// A file sent from the phone, fetched from the Mac with this login.
const fromMac = (url: string): Source => ({ uri: (auth.current()?.server ?? '') + url, headers: signIn() });

// A video stands as its first still, with a play button; until that has come, as a dark square.
function VideoCover({ video, size, onPlay }: { video: SentFile; size: number; onPlay: () => void }) {
  const s = useStyles();
  const [load] = usePicture(fromMac(coverUrl(video.path)));
  const box = [s.picture, { width: size, height: size }];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.playVideo(video.name)} onPress={onPlay}>
      {load.state === 'shown' ? <Image source={{ uri: load.uri }} style={box} /> : <View style={[box, s.videoBlank]} />}
      <View style={s.playOver} pointerEvents="none">
        <View style={s.playDot}>
          <SymbolView name="play.fill" tintColor="#fff" size={20} />
        </View>
      </View>
    </Pressable>
  );
}

// Videos sent with a message, laid out as pictures are; a tap plays one full screen.
export function Videos({ files }: { files: SentFile[] }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const videos = files.filter((f) => f.video);
  if (!videos.length) return null;
  const { across, size } = gridOf(videos.length, width);
  return (
    <View style={[s.pictures, { width: across * size + PICTURE_GAP * (across - 1) }, s.end]}>
      {videos.map((v) => (
        <VideoCover key={v.path} video={v} size={size} onPlay={() => playVideo(v.path)} />
      ))}
    </View>
  );
}

// Other files sent with a message, by their names: what they hold is on the Mac, for Claude.
export function Files({ files: sent }: { files: SentFile[] }) {
  const s = useStyles();
  const { c } = useTheme();
  const files = sent.filter((f) => !f.video);
  if (!files.length) return null;
  return (
    <View style={[s.files, s.end]}>
      {files.map((f) => (
        <View key={f.path} style={s.file}>
          <SymbolView name="doc" tintColor={c.muted} size={18} />
          <Text style={s.fileName} numberOfLines={1} ellipsizeMode="middle">
            {f.name}
          </Text>
        </View>
      ))}
    </View>
  );
}
