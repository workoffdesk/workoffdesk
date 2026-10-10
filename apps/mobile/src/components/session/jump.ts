import { firstShowing } from '@workoffdesk/client/chat/images';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useState } from 'react';
import { Keyboard } from 'react-native';
import type { Jump } from '../turn/common';
import type { Turn } from '@workoffdesk/client/model/chat';
import type { RefObject } from 'react';
import type { Entry } from '../ChatList';

// Long enough for what was asked to show to open before the chat scrolls to it.
export const OPEN_MS = 60;

// A turn asked for from elsewhere in the chat is opened, then scrolled to the middle of the screen.
export function useJump(list: RefObject<LegendListRef | null>, entries: Entry[], inEntry: Map<string, string>, shown: Turn[]) {
  const [opened, setOpened] = useState<Jump['opened']>(null);
  const jumpTo = (key: string | undefined) => {
    const index = key === undefined ? -1 : entries.findIndex((e) => e.key === inEntry.get(key));
    if (key === undefined || index < 0) return;
    // What is jumped to is to be read, in the room the keyboard takes.
    Keyboard.dismiss();
    setOpened((o) => ({ key, n: (o?.n ?? 0) + 1 }));
    setTimeout(() => void list.current?.scrollToIndex({ index, viewPosition: 0.5 }), OPEN_MS);
  };
  const jump: Jump = {
    opened,
    openTool: (toolId) => jumpTo(shown.find((x) => x.k === 'tool' && x.id === toolId)?.key),
    showImage: (path) => jumpTo(firstShowing(shown, path)),
  };
  return jump;
}
