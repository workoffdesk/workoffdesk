import { MACHINE } from '../base/api';
import type { Turn } from '../model/chat';
import type { FileSent } from './fileUpload';
import { t } from '@workoffdesk/i18n';

// Where a path to an image is taken to be written: a word of its own, or right after punctuation, a
// bracket or a marker like [Image #8]; it ends at the end of its name, before punctuation or a space.
const IMAGE_END = String.raw`\.(?:png|jpe?g|gif|webp)`;
const STOP = String.raw`\s\x60'"<>()（）「」『』【】\[\]，。、；：！？`;
const BARE = new RegExp(
  String.raw`(?<=^|[\s\x60'"(（「『【\[\]：:，,])(~?\/(?!\/)[^${STOP}]*?${IMAGE_END})(?=$|[${STOP}]|[.,;:!?](?:$|[${STOP}]))`,
  'giu',
);
// In code a name may have spaces in it.
const IN_CODE = new RegExp(String.raw`\x60(~?\/[^\x60\n]*?${IMAGE_END})\x60`, 'giu');
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const LOCAL_IMAGE = new RegExp(String.raw`^~?\/(?!\/).*${IMAGE_END}$`, 'iu');

// A picture sent from the phone travels as its path on the Mac (that is what Claude reads); saveImage
// names it, so a path is recognised by that name in an uploads folder.
const UPLOAD = /\/uploads\/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.(?:png|jpg|gif|webp)$/;
// What Claude Code writes for a picture it takes in, and what the chat route writes for the picture itself.
const MARKER = /\[Image #\d+\]/g;
const PLACEHOLDER = /\[image\]/g;

const unique = (xs: string[]) => [...new Set(xs)];

// A file sent from the phone travels as its path, quoted, in a folder of its own under uploads (named by
// fileUpload.ts on the Mac); a video also says where its stills are, for Claude to look at.
const FILE_PIECE = String.raw`"(~?\/[^"\n]*\/uploads\/\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\/([^"/\n]+))"(?: \(video: \d+ stills, one every \d+ s, in "[^"\n]+"\))?`;
const SENT_FILE = new RegExp(FILE_PIECE, 'g');
const LEADING_FILE = new RegExp(String.raw`^${FILE_PIECE}(?: |$)`);

export type SentFile = { piece: string; path: string; name: string; video: boolean };
const sentFile = (m: RegExpMatchArray): SentFile => ({ piece: m[0].trimEnd(), path: m[1], name: m[2], video: m[0].includes('(video: ') });

export const filePiece = ({ path, frames }: FileSent) =>
  frames ? `"${path}" (video: ${frames.count} stills, one every ${frames.every} s, in "${frames.dir}/")` : `"${path}"`;

// Images on this Mac a message names by an absolute path, each once, in the order they come.
export function imagePaths(text: string): string[] {
  const found: { at: number; path: string }[] = [];
  for (const m of text.matchAll(IN_CODE)) found.push({ at: m.index, path: m[1] });
  for (const m of text.matchAll(BARE)) found.push({ at: m.index, path: m[1] });
  return unique(found.sort((a, b) => a.at - b.at).map((f) => f.path));
}

const tidy = (text: string) => text.replace(/[ \t]{2,}/g, ' ').trim();

// What was sent from the phone: its pictures as pictures, without the paths, markers and placeholders
// Claude Code keeps for them. A picture that came with no path (pasted on the Mac) is only counted.
// Files sent with it are named, not shown.
export function splitMine(text: string): { images: string[]; files: SentFile[]; text: string; unseen: number } {
  const files = sentFiles(text);
  const withoutFiles = files.length ? text.replace(SENT_FILE, ' ') : text;
  const images = imagePaths(withoutFiles);
  const placeholders = text.match(PLACEHOLDER)?.length ?? 0;
  const uploads = images.filter((p) => UPLOAD.test(p));
  let rest = withoutFiles.replace(MARKER, '').replace(PLACEHOLDER, ' ');
  for (const p of uploads) rest = rest.split(`"${p}"`).join(' ').split(p).join(' ');
  return { images, files, text: rest === text ? text : tidy(rest), unseen: Math.max(0, placeholders - images.length) };
}

// A message of one's own in one line, for a list: its words, and how many pictures go with them.
export function mineInBrief(text: string): string {
  const mine = splitMine(text);
  const pictures = mine.images.length + mine.unseen;
  const extras = [pictures && t.imageCount(pictures), mine.files.length && t.fileCount(mine.files.length)].filter(Boolean).join(' · ');
  if (!extras) return mine.text;
  return mine.text ? `${mine.text} · ${extras}` : extras;
}

// What a reply of Claude's shows besides its words: the images on this Mac it names, and the web images it
// puts in markdown, which are not loaded unless asked for (a reply can be steered to leak through one).
export function replyImages(text: string): { text: string; local: string[]; remote: string[] } {
  const local: string[] = [];
  const remote: string[] = [];
  const rest = text.replace(MARKDOWN_IMAGE, (whole, src: string) => {
    if (/^https?:\/\//i.test(src)) remote.push(src);
    else if (LOCAL_IMAGE.test(src)) local.push(src);
    else return whole;
    return '';
  });
  return { text: rest, local: unique([...local, ...imagePaths(rest)]), remote: unique(remote) };
}

// What to say of a picture the Mac no longer has, when it is known to have been there: one sent from the
// phone (cleared away after a month) or one Claude read. A path a message only names may never have been a
// file, and is left as the words that name it.
export function goneText(path: string, read: boolean): string | null {
  if (UPLOAD.test(path)) return t.imageExpired;
  return read ? t.imageGone : null;
}

// A message with pictures: their paths first, as Claude Code reads a path it is given, then the text. The
// paths are quoted, as one that started the message would make it a command to Claude Code.
export const withPieces = (pieces: string[], text: string) => [...pieces, text].filter(Boolean).join(' ');
export const withPictures = (pictures: string[], text: string) => withPieces(pictures.map((p) => `"${p}"`), text);

// A path at the start, quoted or not (as it was sent before).
const LEADING_PATH = /^("?)(\S+?)\1(?: |$)/;

// A message taken back to change: the pictures and files it was sent with, and its words.
// They lead it, as withPieces puts them.
export function picturesApart(text: string): { pictures: string[]; files: SentFile[]; text: string } {
  const pictures: string[] = [];
  const files: SentFile[] = [];
  let rest = text;
  for (;;) {
    const file = LEADING_FILE.exec(rest);
    const picture = file ? null : LEADING_PATH.exec(rest);
    if (file) files.push(sentFile(file));
    else if (picture && UPLOAD.test(picture[2])) pictures.push(picture[2]);
    else break;
    rest = rest.slice((file ?? picture)![0].length);
  }
  return { pictures, files, text: rest };
}

export const uploadUrl = (path: string) => `/api/uploads/${path.slice(path.lastIndexOf('/') + 1)}`;

// A video sent from the phone, by its folder on the Mac: its first still, and the video itself.
const folderOf = (path: string) => path.split('/').at(-2) ?? '';
export const coverUrl = (path: string) => `/api/uploads/${folderOf(path)}/cover`;
export const videoUrl = (path: string) => `/api/uploads/${folderOf(path)}/video`;

// The files a message carries, as filePiece wrote them.
export const sentFiles = (text: string): SentFile[] => [...text.matchAll(SENT_FILE)].map(sentFile);

// Where the phone gets an image a session names: an upload by its name, anything else from the session,
// which shows only what its transcript names.
export const imageSrc = (sessionId: string, path: string) =>
  UPLOAD.test(path) ? uploadUrl(path) : `/api/m/${MACHINE}/sessions/${sessionId}/image?path=${encodeURIComponent(path)}`;

// One file however its path is written.
export const imageKey = (path: string) => path.replace(/\/{2,}/g, '/').replace(/\/(?:\.\/)+/g, '/');

// The images on this Mac a turn shows as pictures.
export function turnImages(t: Turn): string[] {
  if (t.k === 'user') return splitMine(t.text).images;
  if (t.k === 'text') return replyImages(t.text).local;
  if (t.k === 'tool' && t.name === 'Read' && t.result?.image) return [t.summary];
  return [];
}

// For each turn, by its key, the images it names that an earlier turn already shows: a file is shown
// as a picture once, where it first appears.
export function shownEarlier(turns: Turn[]): Map<string, Set<string>> {
  const seen = new Set<string>();
  const out = new Map<string, Set<string>>();
  for (const t of turns) {
    for (const path of turnImages(t)) {
      const key = imageKey(path);
      if (!seen.has(key)) seen.add(key);
      else out.set(t.key, (out.get(t.key) ?? new Set()).add(path));
    }
  }
  return out;
}

// The key of the turn that shows a picture first, where a later mention of it points back to.
export function firstShowing(turns: Turn[], path: string): string | undefined {
  const key = imageKey(path);
  return turns.find((t) => turnImages(t).some((p) => imageKey(p) === key))?.key;
}
