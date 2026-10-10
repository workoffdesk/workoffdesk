import { errorText } from '@workoffdesk/client/base/api';
import { newUploadId, sendFile } from '@workoffdesk/client/chat/fileUpload';
import { filePiece, sentFiles } from '@workoffdesk/client/chat/images';
import type { Attachment, Composer, ComposerSnapshot } from '@workoffdesk/client/composer/composer';
import { t } from '@workoffdesk/i18n';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Alert, Keyboard, useWindowDimensions, View } from 'react-native';
import { api } from '../../client';
import { playVideo } from '../VideoPlayer';
import { refused, type Source } from './sending';

export const PICKED_AT_MOST = 6;
// A picture is sent as Claude reads it, not printed: a JPEG at this quality, its long edge no longer than the
// size Anthropic's API scales larger pictures down to.

const PICTURE_QUALITY = 0.6;

const PICTURE_EDGE = 1568;
// A video this large is asked about first: as it is, it takes a while over a slow line. Made smaller, it is
// 720p, as wide as the stills Claude is given of it.

export const LARGE_VIDEO = 200 * 1024 * 1024;

export const SMALLER_VIDEO = ImagePicker.VideoExportPreset.H264_1280x720;
// 5pt apart across about 270pt, as the web's wave.

// A picture made the size it is sent at, encoded once. As picked when that fails.
export async function sendable(a: ImagePicker.ImagePickerAsset): Promise<string> {
  try {
    const picture = ImageManipulator.manipulate(a.uri);
    if (Math.max(a.width, a.height) > PICTURE_EDGE) picture.resize(a.width >= a.height ? { width: PICTURE_EDGE } : { height: PICTURE_EDGE });
    const made = await (await picture.renderAsync()).saveAsync({ compress: PICTURE_QUALITY, format: SaveFormat.JPEG });
    return made.uri;
  } catch {
    return a.uri;
  }
}

// The bytes say what a file is, whatever the phone calls it; the Mac answers with where it saved them. Sent
// again when the line drops: one that arrived twice is saved twice, and only the path answered is used.
export async function upload(uri: string): Promise<string> {
  const body = await (await fetch(uri)).blob();
  const saved = await api<{ path: string }>('/api/uploads', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body, idempotent: true });
  return saved.path;
}

// A video or a file goes up in parts, read from the phone a part at a time, so a large one is never held whole.
export async function uploadFile(file: File, name: string, sent: (share: number) => void): Promise<string> {
  const size = file.size ?? 0;
  const handle = file.open();
  try {
    const read = (at: number, length: number) => {
      handle.offset = at;
      return handle.readBytes(length);
    };
    return filePiece(await sendFile(api, { id: newUploadId(), name, size, read }, (n) => sent(size ? n / size : 1)));
  } finally {
    handle.close();
  }
}

// What goes with a message: pictures, videos and files, picked from the menu over the + button, and opened
// from their tiles.
export function useAttachments(composer: Composer<Source>, box: ComposerSnapshot<Source>, onError: (message: string) => void) {
  // A picture opens full screen among the others; a video plays once it is on the Mac.
  const pictures = box.attached.flatMap((p) => (p.kind === 'picture' && p.source ? [{ key: p.key, name: p.name, source: { uri: p.source.uri, headers: p.source.headers ?? {} } }] : []));
  const [viewing, setViewing] = useState<number | null>(null);
  const videoOf = (p: Attachment<Source>) => (p.kind === 'video' && p.piece ? sentFiles(p.piece)[0]?.path : undefined);
  const opens = (p: Attachment<Source>) => !!videoOf(p) || pictures.some((x) => x.key === p.key);
  const open = (p: Attachment<Source>) => {
    const video = videoOf(p);
    if (video) playVideo(video);
    else setViewing(pictures.findIndex((x) => x.key === p.key));
  };

  // Pictures, videos and files
  const sentOf = (key: string) => (share: number) => composer.progress(key, share);
  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    for (const a of assets) {
      if (a.type === 'video') composer.attach('video', a.fileName ?? 'video.mov', (key) => uploadFile(new File(a.uri), a.fileName ?? 'video.mov', sentOf(key)));
      else composer.attach('picture', a.fileName ?? '', async () => `"${await upload(await sendable(a))}"`, { uri: a.uri });
    }
  };
  const fromLibrary = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: PICKED_AT_MOST,
    });
    if (r.canceled) return;
    const sizeOf = (a: ImagePicker.ImagePickerAsset) => a.fileSize ?? new File(a.uri).size ?? 0;
    const large = r.assets.filter((a) => a.type === 'video' && sizeOf(a) > LARGE_VIDEO);
    add(r.assets.filter((a) => !large.includes(a)));
    if (!large.length) return;
    const mb = Math.round(large.reduce((sum, a) => sum + sizeOf(a), 0) / 1024 / 1024);
    Alert.alert(t.largeVideo(large.length, mb), t.largeVideoSub(large.length), [
      { text: t.sendAsIs, onPress: () => add(large) },
      { text: t.sendSmaller, onPress: () => void smallerFromLibrary(large.length) },
      { text: t.cancel, style: 'cancel' },
    ]);
  };
  // iOS makes a video smaller only as it is picked, so it is picked again.
  const smallerFromLibrary = async (count: number) => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: count > 1,
      selectionLimit: count,
      videoExportPreset: SMALLER_VIDEO,
    });
    if (!r.canceled) add(r.assets);
  };
  const fromFiles = async () => {
    const r = await File.pickFileAsync({ multipleFiles: true });
    if (r.canceled) return;
    for (const f of r.result) composer.attach('file', f.name, (key) => uploadFile(f, f.name, sentOf(key)));
  };
  const fromCamera = async () => {
    if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return refused(t.cameraDenied);
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
    if (!r.canceled) add(r.assets);
  };
  // A menu right above the button, where the thumb already is; a tap anywhere else closes it. What was
  // picked opens once the menu has gone, as iOS shows one thing over the page at a time.
  const pictureButton = useRef<View>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const picked = useRef<(() => Promise<void>) | null>(null);
  const windowHeight = useWindowDimensions().height;
  const choose = () => {
    Keyboard.dismiss();
    pictureButton.current?.measureInWindow((x, y) => setMenuAt({ x, y }));
  };
  const pickFrom = (from: () => Promise<void>) => {
    picked.current = from;
    setMenuAt(null);
  };
  const openPicked = () => {
    const from = picked.current;
    picked.current = null;
    from?.().catch((e) => onError(errorText(e, t.uploadFailed)));
  };
  return { pictures, viewing, setViewing, opens, open, fromLibrary, fromFiles, fromCamera, pictureButton, menuAt, setMenuAt, windowHeight, choose, pickFrom, openPicked };
}
