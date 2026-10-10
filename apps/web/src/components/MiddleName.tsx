import { useLayoutEffect, useRef, useState } from 'react';

// A file's name cut in its middle where it does not fit, as the phone shows it: as many letters of its start as
// of its end, which says what kind of file it is. On up to lines lines, broken anywhere. The whole name, unseen,
// keeps the room it would take, so what is cut is measured against the room there is, not against itself.
export function MiddleName({ name, lines = 1, className = '' }: { name: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      setShown(cutToFit(name, el.clientWidth, lines, `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`));
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(el);
    return () => seen.disconnect();
  }, [name, lines]);
  return (
    <span ref={ref} className={`middle-name ${className}`} title={name}>
      <span className="middle-room" aria-hidden>
        {name}
      </span>
      <span className="middle-shown" style={{ WebkitLineClamp: lines }}>
        {shown}
      </span>
    </span>
  );
}

let pen: CanvasRenderingContext2D | null = null;

// The most of name's start and end, as many letters of each, that fills no more than lines lines of width.
function cutToFit(name: string, width: number, lines: number, font: string): string {
  pen ??= document.createElement('canvas').getContext('2d');
  const p = pen;
  if (!p || width <= 0) return name;
  p.font = font;
  const fits = (letters: string[]) => {
    let line = 1;
    let x = 0;
    for (const l of letters) {
      const w = p.measureText(l).width;
      if (x > 0 && x + w > width) {
        line++;
        x = 0;
      }
      x += w;
    }
    return line <= lines;
  };
  const letters = [...name];
  if (fits(letters)) return name;
  const keep = (n: number) => [...letters.slice(0, Math.ceil(n / 2)), '…', ...letters.slice(letters.length - Math.floor(n / 2))];
  let lo = 0;
  let hi = letters.length - 1;
  while (lo < hi) {
    const n = Math.ceil((lo + hi) / 2);
    if (fits(keep(n))) lo = n;
    else hi = n - 1;
  }
  return keep(lo).join('');
}
