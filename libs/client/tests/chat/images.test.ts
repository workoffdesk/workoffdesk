import { describe, expect, it } from 'vitest';
import { firstShowing, imagePaths, imageSrc, mineInBrief, picturesApart, replyImages, shownEarlier, splitMine, uploadUrl, withPictures } from '../../src/chat/images';
import { t } from '@workoffdesk/i18n';

const pic = '/Users/me/.workoffdesk/uploads/2026-10-03-191036-83c3d5.png';
const jpg = '/tmp/h/uploads/2026-10-03-191300-cac205.jpg';

describe('imagePaths', () => {
  it.each([
    ['a path on its own', '/Users/me/shot.png', ['/Users/me/shot.png']],
    ['one from home', '截好了 ~/Desktop/a.webp', ['~/Desktop/a.webp']],
    ['one closed by Chinese punctuation', '截图在 /tmp/x/shot.png。看看', ['/tmp/x/shot.png']],
    ['one ending a sentence', 'Saved to /tmp/x/shot.jpeg.', ['/tmp/x/shot.jpeg']],
    ['one after a colon', '截图：/tmp/a.gif', ['/tmp/a.gif']],
    ['one in code', '看 `/tmp/a.PNG` 这张', ['/tmp/a.PNG']],
    ['one in code with spaces in its name', '在 `~/Desktop/截图 2026-10-03 1.png` 里', ['~/Desktop/截图 2026-10-03 1.png']],
    ['one in brackets', '（见 /tmp/a.png）和 [b](/tmp/b.png)', ['/tmp/a.png', '/tmp/b.png']],
    ['right after a marker', `[Image #8]${pic} 这个`, [pic]],
    ['in quotes, as the app sends it', `"${pic}" 这个`, [pic]],
    ['in quotes after a marker', `"[Image #8]${pic}" 这个`, [pic]],
    ['each once, in order', '/tmp/b.png 和 /tmp/a.png 还有 `/tmp/b.png`', ['/tmp/b.png', '/tmp/a.png']],
    ['none that is not an image', '/tmp/notes.txt 和 /tmp/a.png.bak', []],
    ['none of a web address', 'https://example.com/a.png', []],
    ['none that is relative', 'shots/a.png ./b.png', []],
    ['none inside a longer word', 'foo/tmp/a.png', []],
  ])('finds %s', (_, text, paths) => {
    expect(imagePaths(text)).toEqual(paths);
  });
});

describe('splitMine', () => {
  it.each([
    ['a picture on its own', pic, [pic], '', 0],
    ['pictures and words, in any order', `${pic} 看看这两张 ${jpg}`, [pic, jpg], '看看这两张', 0],
    ['words across lines, kept as written', `第一行\n第二行 ${pic}`, [pic], '第一行\n第二行', 0],
    ['no picture', '只是一句话', [], '只是一句话', 0],
    // What Claude Code records for a picture pasted as its path: its marker, the path, and the picture itself.
    ['a picture Claude Code took in, shown once', `[Image #8]${pic} 这个 [image]`, [pic], '这个', 0],
    ['two of them', `[Image #1]${pic} [Image #2]${jpg} 对比 [image] [image]`, [pic, jpg], '对比', 0],
    ['quoted, as the app sends them', `"${pic}" "${jpg}" 对比`, [pic, jpg], '对比', 0],
    ['quoted, as Claude Code keeps them', `"[Image #1]${pic}" 对比 [image]`, [pic], '对比', 0],
    ['a picture with no path to show it by', '看这个 [Image #3] [image]', [], '看这个', 1],
    ['a path of the owner\'s own, kept in the words', '看看 /tmp/a.png', ['/tmp/a.png'], '看看 /tmp/a.png', 0],
  ])('splits %s', (_, text, images, rest, unseen) => {
    expect(splitMine(text)).toEqual({ images, files: [], text: rest, unseen });
  });
});

describe('mineInBrief', () => {
  it.each([
    ['words alone, as written', '只是一句话', '只是一句话'],
    ['words and pictures: the words, then how many', `${pic} 看看这两张 ${jpg}`, `看看这两张 · ${t.imageCount(2)}`],
    ['pictures alone: how many', pic, t.imageCount(1)],
    ['one pasted on the Mac counts too', '看这个 [Image #3] [image]', `看这个 · ${t.imageCount(1)}`],
  ])('shows %s', (_, text, brief) => {
    expect(mineInBrief(text)).toBe(brief);
    expect(mineInBrief(text)).not.toMatch(/uploads\//);
  });
});

describe('picturesApart', () => {
  it.each([
    ['pictures and words', withPictures([pic, jpg], '看看这两张'), [pic, jpg], '看看这两张'],
    ['pictures alone', withPictures([pic], ''), [pic], ''],
    ['words alone', '只是一句话', [], '只是一句话'],
    ['a path of the owner\'s own stays in the words', '看看 /tmp/a.png', [], '看看 /tmp/a.png'],
    ['words across lines, kept as written', withPictures([pic], '第一行\n第二行'), [pic], '第一行\n第二行'],
  ])('takes apart %s', (_, text, pictures, words) => {
    expect(picturesApart(text)).toEqual({ pictures, files: [], text: words });
    expect(withPictures(pictures, words)).toBe(text);
  });

  it('takes apart one sent before the paths were quoted', () => {
    expect(picturesApart(`${pic} ${jpg} 看看`)).toEqual({ pictures: [pic, jpg], files: [], text: '看看' });
  });
});

describe('replyImages', () => {
  it('shows the images a reply names under it and keeps the words as written', () => {
    expect(replyImages('截好了：/tmp/a.png，另一张在 `~/b.jpg`')).toEqual({
      text: '截好了：/tmp/a.png，另一张在 `~/b.jpg`',
      local: ['/tmp/a.png', '~/b.jpg'],
      remote: [],
    });
  });

  it('takes markdown images out of the words, local ones to show and web ones to open', () => {
    expect(replyImages('看图：\n\n![截图](/tmp/a.png)\n\n![logo](https://example.com/l.png "Logo") 完')).toEqual({
      text: '看图：\n\n\n\n 完',
      local: ['/tmp/a.png'],
      remote: ['https://example.com/l.png'],
    });
  });

  it('leaves a markdown image it cannot show where it is', () => {
    const text = '![x](shots/a.png) ![y](javascript:alert(1))';
    expect(replyImages(text)).toEqual({ text, local: [], remote: [] });
  });

  it('shows each image once', () => {
    expect(replyImages('![a](/tmp/a.png) 就是 /tmp/a.png').local).toEqual(['/tmp/a.png']);
    expect(replyImages('![a](https://x.test/a.png) ![b](https://x.test/a.png)').remote).toEqual(['https://x.test/a.png']);
  });
});

describe('imageSrc', () => {
  it('asks for an upload by its name alone', () => {
    expect(uploadUrl(pic)).toBe('/api/uploads/2026-10-03-191036-83c3d5.png');
    expect(imageSrc('abc', pic)).toBe('/api/uploads/2026-10-03-191036-83c3d5.png');
  });

  it('asks the session for any other image by the path as written', () => {
    expect(imageSrc('abc', '~/Desktop/截图 1.png')).toBe(`/api/m/local/sessions/abc/image?path=${encodeURIComponent('~/Desktop/截图 1.png')}`);
  });
});

describe('shownEarlier', () => {
  const sent = { k: 'user' as const, text: `[Image #1]${pic} 看这张`, key: 'u1' };
  const read = (key: string, path: string) => ({ k: 'tool' as const, id: key, name: 'Read', summary: path, key, result: { text: '[image]', error: false, image: true as const } });
  const reply = (key: string, text: string) => ({ k: 'text' as const, text, key });

  it('marks a picture Claude reads as shown when the user sent that file before', () => {
    const r = shownEarlier([sent, read('r1', pic)]);
    expect([...(r.get('r1') ?? [])]).toEqual([pic]);
    expect(r.get('u1')).toBeUndefined();
  });

  it('marks a picture as shown when an earlier reply named that file', () => {
    const r = shownEarlier([reply('a1', `截好了：${jpg}`), read('r1', jpg), reply('a2', `再看 ${jpg}`)]);
    expect([...(r.get('r1') ?? [])]).toEqual([jpg]);
    expect([...(r.get('a2') ?? [])]).toEqual([jpg]);
  });

  it('goes by the whole path, so a file of the same name elsewhere is another picture', () => {
    const other = pic.replace('/uploads/', '/other/');
    expect(shownEarlier([sent, read('r1', other)]).get('r1')).toBeUndefined();
  });

  it('treats a path with doubled or dotted slashes as the same file', () => {
    const r = shownEarlier([sent, read('r1', pic.replace('/uploads/', '//uploads/./'))]);
    expect(r.get('r1')?.size).toBe(1);
  });

  it('shows a picture first seen in a read, and nothing for a read with no picture', () => {
    const textRead = { ...read('r2', jpg), result: { text: 'not an image', error: false } };
    const r = shownEarlier([read('r1', pic), textRead, reply('a1', `见 ${jpg}`)]);
    expect(r.get('r1')).toBeUndefined();
    expect(r.get('a1')).toBeUndefined();
  });
});

describe('firstShowing', () => {
  const sent = { k: 'user' as const, text: `[Image #1]${pic} 看这张`, key: 'u1' };
  const read = (key: string, path: string) => ({ k: 'tool' as const, id: key, name: 'Read', summary: path, key, result: { text: '[image]', error: false, image: true as const } });
  const reply = (key: string, text: string) => ({ k: 'text' as const, text, key });

  it('returns the turn that first shows a picture, which later ones point back to', () => {
    expect(firstShowing([reply('a0', 'no picture'), sent, read('r1', pic)], pic)).toBe('u1');
    expect(firstShowing([reply('a1', `截好了：${jpg}`), read('r1', jpg)], jpg)).toBe('a1');
  });

  it('matches the same file written another way', () => {
    expect(firstShowing([read('r1', '/tmp//h/./uploads/2026-10-03-191300-cac205.jpg')], jpg)).toBe('r1');
  });

  it('returns nothing when no turn shows it', () => {
    expect(firstShowing([reply('a1', 'none'), read('r1', jpg)], pic)).toBeUndefined();
  });
});

describe('withPictures', () => {
  it.each([
    ['puts the paths first, quoted, then the text', ['/u/a.png', '/u/b.jpg'], 'what is this', '"/u/a.png" "/u/b.jpg" what is this'],
    ['with no text, leaves no space at the end', ['/u/a.png'], '', '"/u/a.png"'],
    ['with no pictures, is the text alone', [], 'just words', 'just words'],
    ['with neither, is nothing', [], '', ''],
  ])('%s', (_, pictures, text, out) => {
    expect(withPictures(pictures, text)).toBe(out);
  });

  // Claude Code takes a message that starts with a slash for a command, and runs nothing.
  it.each([
    ['words', 'what is this'],
    ['no words', ''],
    ['a command of its own after the picture', '/compact'],
  ])('never starts a message with a slash: %s', (_, text) => {
    expect(withPictures(['/Users/me/.workoffdesk/uploads/2026-10-05-214430-386317.jpg'], text)).toMatch(/^[^/]/);
  });
});
