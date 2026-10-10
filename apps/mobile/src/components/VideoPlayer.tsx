import { videoUrl } from '@workoffdesk/client/chat/images';
import { t } from '@workoffdesk/i18n';
import { useEvent } from 'expo';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth, signIn } from '../client';

// The video playing, by its path on the Mac. It is held here, above every page, so it plays on until it is
// closed, whatever happens meanwhile to the message it was opened from.
let playing: string | null = null;
const listeners = new Set<() => void>();
const setPlaying = (path: string | null) => {
  playing = path;
  for (const f of listeners) f();
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export const playVideo = (path: string) => setPlaying(path);

// Where the video plays: mounted once, at the root.
export function VideoPlayer() {
  const path = useSyncExternalStore(subscribe, () => playing);
  return path ? <Player key={path} path={path} onClose={() => setPlaying(null)} /> : null;
}

// A video full screen on black, played from the Mac with this login, in the ranges the player asks for.
function Player({ path, onClose }: { path: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const source = useMemo(() => ({ uri: (auth.current()?.server ?? '') + videoUrl(path), headers: signIn() }), [path]);
  const player = useVideoPlayer(source, (p) => p.play());
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (status !== 'error') return;
    let open = true;
    // The player says only that it failed: ask the Mac whether the video is still there.
    fetch(source.uri, { headers: { ...source.headers, range: 'bytes=0-0' } }).then(
      (r) => open && setGone(r.status === 404),
      () => {},
    );
    return () => {
      open = false;
    };
  }, [status, source]);
  const again = () => void player.replaceAsync(source).then(() => player.play());
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[s.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.bar}>
          <Pressable style={s.close} accessibilityRole="button" accessibilityLabel={t.close} hitSlop={10} onPress={onClose}>
            <SymbolView name="xmark" tintColor="#fff" size={18} weight="semibold" />
          </Pressable>
        </View>
        <View style={s.video}>
          {status !== 'error' && <VideoView player={player} style={s.video} nativeControls contentFit="contain" />}
          {status === 'loading' && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#fff" pointerEvents="none" />}
          {status === 'error' && (
            <View style={[StyleSheet.absoluteFill, s.failed]}>
              <Pressable style={s.retry} accessibilityRole="button" disabled={gone} onPress={again}>
                <Text style={s.retryText}>{gone ? t.videoGone : t.videoNotLoaded}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 12 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  video: { flex: 1, backgroundColor: '#000' },
  failed: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  retry: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)' },
  retryText: { color: '#fff', fontSize: 15, textAlign: 'center' },
});
