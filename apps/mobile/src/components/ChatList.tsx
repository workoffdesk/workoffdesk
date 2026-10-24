import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import type { LegendListRef } from '@legendapp/list/react-native';
import { t } from '@workoffdesk/i18n';
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { reportChatEnd } from '../client';
import { useTheme } from '../theme';

// How far from the end a scroll that rests there may be, for rounding.
const AT_END_PX = 4;

// Whether a scroll leaves the last row and the room under it in view, by the scroll view's own numbers.
const atEnd = ({ nativeEvent: n }: NativeSyntheticEvent<NativeScrollEvent>) => endReached(n);
const endReached = (n: NativeScrollEvent) => n.contentOffset.y + n.layoutMeasurement.height >= n.contentSize.height + n.contentInset.bottom - AT_END_PX;
// How long a scroll let go of takes to come to rest, a bounce back included.
const SETTLE_MS = 600;
// How far into the dock the last row may reach, for rounding.
const UNDER_DOCK_PX = 2;

// One row of the chat.
export type Entry = { key: string; node: ReactNode };

// The conversation, first to last, in a list the keyboard extends instead of reflowing. At the end it follows
// what comes in; scrolled away from it, nothing moves what is being read, until a send here goes back to it.
export function ChatList({
  listRef,
  entries,
  sentId,
  onOlder,
  loadingOlder,
  room,
  dock,
  freeze,
  keyboardOffset,
  empty,
  onAway,
  onLaidOut,
}: {
  listRef: RefObject<LegendListRef | null>;
  entries: Entry[];
  // The newest message sent from this phone.
  sentId: string | undefined;
  onOlder: () => void;
  loadingOlder: boolean;
  // How much of the end the dock under the chat covers.
  room: number;
  dock: RefObject<View | null>;
  freeze: SharedValue<boolean>;
  keyboardOffset: number;
  empty: ReactElement | null;
  onAway: (away: boolean) => void;
  // The list has laid out its rows at its end and shows them: until then they are drawn unseen.
  onLaidOut: () => void;
}) {
  const theme = useTheme();
  const [following, setFollowing] = useState(true);
  const [followedFor, setFollowedFor] = useState(sentId);
  if (sentId !== followedFor) {
    setFollowedFor(sentId);
    if (sentId) setFollowing(true);
  }
  // Whether the chat follows its end now, not a render later: a drag that has begun is not pulled back to it.
  const followed = useRef(following);
  useEffect(() => void (followed.current = following), [following]);
  const follow = (on: boolean) => {
    followed.current = on;
    setFollowing(on);
  };

  // Where the scroll view last was, and each row on screen: a scroll that comes to rest at the scroll view's end
  // with the last row still under the dock is told to the Mac, once a visit, with what each part measured.
  const scrolled = useRef<NativeScrollEvent | null>(null);
  const scrolledAt = useRef(0);
  const footer = useRef<View>(null);
  const rowViews = useRef(new Map<string, View>()).current;
  const told = useRef(false);
  const mountedAt = useRef(0);
  useEffect(() => void (mountedAt.current = Date.now()), []);
  const lastKey = entries.at(-1)?.key;
  const checkRest = () =>
    setTimeout(() => {
      const n = scrolled.current;
      const row = lastKey === undefined ? undefined : rowViews.get(lastKey);
      if (told.current || !n || !row || !dock.current || !footer.current || !endReached(n)) return;
      const [under, end] = [dock.current, footer.current];
      row.measureInWindow((_x, rowTop, _w, rowHeight) =>
        under.measureInWindow((_dx, dockTop) => end.measureInWindow((_fx, footerTop) => {
          if (told.current || rowTop + rowHeight <= dockTop + UNDER_DOCK_PX) return;
          told.current = true;
          const state = listRef.current?.getState();
          const last = entries.length - 1;
          reportChatEnd({
            rowBottom: rowTop + rowHeight,
            dockTop,
            dock: room,
            offset: n.contentOffset.y,
            viewHeight: n.layoutMeasurement.height,
            contentHeight: n.contentSize.height,
            insetBottom: n.contentInset.bottom,
            listLength: state?.contentLength ?? null,
            lastAt: state?.positionAtIndex(last) ?? null,
            lastSize: state?.sizeAtIndex(last) ?? null,
            rows: entries.length,
            sinceOpen: Date.now() - mountedAt.current,
            // Measured now, where the scroll event's numbers above may be older: the room drawn after the rows,
            // how long ago the scroll view last told where it was, and whether the chat was following the end.
            footerTop,
            scrolledAgo: Date.now() - scrolledAt.current,
            following: followed.current ? 1 : 0,
          });
        })),
      );
    }, SETTLE_MS);

  const followIfAtEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (atEnd(e)) follow(true);
    checkRest();
  };

  const renderEntry = useCallback(
    ({ item }: { item: Entry }) => (
      <View
        style={s.entry}
        ref={(v) => {
          if (v) rowViews.set(item.key, v);
          else rowViews.delete(item.key);
        }}
      >
        {item.node}
      </View>
    ),
    [rowViews],
  );

  return (
    <KeyboardAwareLegendList
      ref={listRef}
      testID="chat"
      data={entries}
      keyExtractor={keyOf}
      renderItem={renderEntry}
      initialScrollAtEnd
      // Rows of markdown can take longer to lay out than the list waits for its first scroll to the end.
      onReady={() => {
        void listRef.current?.scrollToEnd({ animated: false });
        onLaidOut();
      }}
      recycleItems={false}
      alignItemsAtEnd
      maintainVisibleContentPosition
      maintainScrollAtEnd={following ? { on: { dataChange: true, itemLayout: true, footerLayout: true } } : false}
      // The scroll view tells when what it holds grows or shrinks, a new row, a row laid out anew or the room under
      // them: following, the chat goes to the scroll view's own end then, wherever the list reckoned the end was.
      onContentSizeChange={() => {
        // React Native's scroll responder is the ScrollView itself (ScrollView.js, getScrollResponder).
        if (followed.current) (listRef.current?.getScrollResponder() as ScrollView | undefined)?.scrollToEnd({ animated: false });
      }}
      onScroll={(e) => {
        scrolled.current = e.nativeEvent;
        scrolledAt.current = Date.now();
        onAway(!atEnd(e));
      }}
      onScrollBeginDrag={() => follow(false)}
      // Brought back to the end by hand, slowly or with a fling, the chat follows it again.
      onScrollEndDrag={followIfAtEnd}
      onMomentumScrollEnd={followIfAtEnd}
      onStartReached={onOlder}
      onStartReachedThreshold={1}
      keyboardLiftBehavior="whenAtEnd"
      keyboardOffset={keyboardOffset}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      freeze={freeze}
      applyWorkaroundForContentInsetHitTestBug
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      estimatedItemSize={160}
      contentContainerStyle={s.content}
      ListHeaderComponent={loadingOlder ? <ActivityIndicator style={s.older} accessibilityLabel={t.loadingEarlier} color={theme.c.muted} /> : null}
      // The dock's room is the end of the content, not an inset of the scroll view's: it is drawn with the
      // rows, so the scroll view cannot reach an end the dock covers.
      ListFooterComponent={<View ref={footer} style={{ height: room }} />}
      ListEmptyComponent={empty}
    />
  );
}

const keyOf = (e: Entry) => e.key;

const s = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingVertical: 12 },
  entry: { paddingVertical: 7 },
  older: { paddingVertical: 12 },
});
