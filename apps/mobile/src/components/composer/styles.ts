import { StyleSheet } from 'react-native';
import { MONO, tint, type Theme } from '../../theme';

export type S = ReturnType<typeof styles>;

// Where the two targets sit above the safe area: their bottom, and their top with the label under the dot.
export const TARGETS_BOTTOM = 168;

export const TARGETS_TOP = TARGETS_BOTTOM + 60 * 1.22 + 6 + 20;
// What is heard shows up to four lines, under its label.

const heardLines = (fs: Theme['fs']) => fs(20) * 1.5 * 4 + 20;
// How far over the page the glow fades in.

export const FADE_PX = 40;

export const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    wrap: { gap: 8 },
    composer: { padding: 6, borderRadius: 26, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, minHeight: 40 },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    footMain: { flex: 1, minWidth: 0 },
    // As tall and as round as the session pill beside it.
    keysToggle: { minWidth: 48, minHeight: 32, marginBottom: 2, marginRight: 4, paddingHorizontal: 10, borderRadius: 16, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    keysShown: { backgroundColor: tint(c.accent, 14) },
    field: { flex: 1 },
    tool: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    input: { minHeight: 40, maxHeight: 120, paddingTop: 9, paddingBottom: 9, paddingHorizontal: 6, fontSize: Math.max(16, fs(16)), lineHeight: Math.max(16, fs(16)) * 1.35, color: c.text },
    holdBar: { ...StyleSheet.absoluteFill, justifyContent: 'center', paddingHorizontal: 6 },
    holdText: { fontSize: Math.max(16, fs(16)), color: c.muted },
    send: { width: 44, height: 44, marginVertical: -2, alignItems: 'center', justifyContent: 'center' },
    sendDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent },
    stopDot: { backgroundColor: c.danger },
    stopSquare: { width: 12, height: 12, borderRadius: 2, backgroundColor: c.accentText },
    pictures: { gap: 8, paddingHorizontal: 4, paddingTop: 4 },
    picture: { width: 64, height: 64 },
    thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: c.surface2 },
    fileTile: { width: 160, height: 64, borderRadius: 12, backgroundColor: c.surface2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
    fileText: { flex: 1, gap: 2 },
    fileName: { fontSize: fs(12), color: c.text },
    fileSent: { fontSize: fs(11), color: c.muted },
    videoBlank: { backgroundColor: '#1c1c1e' },
    videoSent: { color: '#fff', fontSize: fs(13), fontWeight: '600', fontVariant: ['tabular-nums'] },
    thumbCover: { ...StyleSheet.absoluteFill, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
    remove: { position: 'absolute', top: -6, right: -6, borderRadius: 11, backgroundColor: c.surface },
    menu: { maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    option: { paddingVertical: 9, paddingHorizontal: 14, gap: 2 },
    pressed: { backgroundColor: c.surface2 },
    optionName: { fontFamily: MONO, fontSize: fs(14), fontWeight: '600', color: c.text },
    optionSub: { fontSize: fs(12), color: c.muted },
    snippet: { fontSize: fs(15), fontWeight: '600', color: c.text },
    panel: { position: 'absolute' },
    sources: {
      position: 'absolute',
      minWidth: 180,
      padding: 6,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    source: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 10 },
    sourcePressed: { backgroundColor: c.surface2 },
    sourceText: { fontSize: fs(16), color: c.text },
    heard: {
      position: 'absolute',
      left: 16,
      right: 16,
      paddingTop: 10,
      borderRadius: 18,
      backgroundColor: c.surface,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    heardLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16 },
    heardLabelText: { fontSize: fs(13), lineHeight: fs(13) * 1.4, fontWeight: '600', color: c.glow[3] },
    heardScroll: { maxHeight: heardLines(fs) },
    heardText: { paddingTop: 2, paddingBottom: 12, paddingHorizontal: 16, fontSize: fs(20), lineHeight: fs(20) * 1.5, color: c.text },
    targets: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
    target: { flex: 1, alignItems: 'center', gap: 6 },
    targetActive: { transform: [{ scale: 1.22 }] },
    targetDot: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
    targetDotActive: { backgroundColor: '#fff', borderColor: '#fff' },
    targetLabel: { fontSize: fs(13), fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
    white: { color: '#fff' },
    hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: fs(15), lineHeight: 20, color: 'rgba(255,255,255,0.88)' },
    hintStrong: { color: '#fff', fontWeight: '600' },
    waveAt: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  });
