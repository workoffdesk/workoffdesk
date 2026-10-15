import { useLayoutEffect, useRef } from 'react';

// The end of a read-only chat stays in sight while the reader is at it, as turns come in and as the page and
// what is below it change size.
export function useStayAtEnd(turnCount: number) {
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    };
    keep();
    const seen = new ResizeObserver(keep);
    seen.observe(el);
    for (const child of el.children) seen.observe(child);
    return () => seen.disconnect();
  }, [turnCount]);
  const noteWhere = () => {
    const el = scroller.current;
    if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { scroller, noteWhere };
}
