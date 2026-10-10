import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Usage } from '../api';
import { effortName, effortsOf, modelItems } from '@workoffdesk/client/model/chat';
import { MODES, modeName } from '@workoffdesk/client/composer/modes';
import { pillFigure, usageLines, usageText, type PillFigure, type SessionPillProps } from '@workoffdesk/client/mac/usage';
import { press } from './KeyBar';
import { t } from '@workoffdesk/i18n';

const GAP_PX = 6;

type Item = { label: string; current?: boolean; sub?: string; pick: () => void };

// A part of the session pill that opens a small menu just above it; the menu closes on a pick or a tap elsewhere.
function KeyMenu(props: { label: ReactNode; ariaLabel: string; className?: string; items?: Item[]; children?: (close: () => void) => ReactNode }) {
  const key = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left?: number; right?: number; bottom: number; maxHeight: number } | null>(null);
  const close = () => setAt(null);
  const toggle = () => {
    const r = key.current?.getBoundingClientRect();
    if (at || !r) return close();
    const bottom = window.innerHeight - r.top + GAP_PX;
    const maxHeight = r.top - 2 * GAP_PX;
    // Opens toward the side with room: from a key's left edge on the left half, from its right edge on the right.
    setAt(
      r.left < window.innerWidth / 2
        ? { left: Math.max(GAP_PX, r.left), bottom, maxHeight }
        : { right: Math.max(GAP_PX, window.innerWidth - r.right), bottom, maxHeight },
    );
  };
  return (
    <>
      <button ref={key} className={`pill-part ${props.className ?? ''}`} aria-label={props.ariaLabel} aria-haspopup="menu" aria-expanded={!!at} {...press(toggle)}>
        {props.label}
      </button>
      {at &&
        createPortal(
          <>
            <div className="menu-scrim" onPointerDown={(e) => (e.preventDefault(), close())} />
            <div className="key-menu" role="menu" style={at}>
              {props.children?.(close)}
              {props.items?.map((it) => (
                <button
                  key={it.label}
                  role="menuitemradio"
                  aria-checked={!!it.current}
                  className={it.current ? 'key-menu-item current' : 'key-menu-item'}
                  {...press(() => {
                    close();
                    if (!it.current) it.pick();
                  })}
                >
                  <span className="key-menu-body">
                    <span>{it.label}</span>
                    {it.sub && <span className="key-menu-sub">{it.sub}</span>}
                  </span>
                  {it.current && <span className="key-menu-check">✓</span>}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export function ModeKey(props: { mode: string | null | undefined; switching?: boolean; onMode: (mode: string | null) => void }) {
  const { mode } = props;
  return (
    <KeyMenu
      label={props.switching ? t.switchingMode : mode === undefined ? t.permissions : modeName(mode)}
      ariaLabel={t.permissionsIs(mode === undefined ? t.unknown : modeName(mode))}
      className={mode === 'bypass permissions' ? 'bypass' : undefined}
      items={MODES.map((m) => ({ label: m.name, current: m.mode === mode, pick: () => props.onMode(m.mode) }))}
    />
  );
}

// Where the pill will be until the session says what runs in it.
export function PillSkeleton() {
  return <div className="pill pill-skeleton" role="status" aria-label={t.reading} />;
}

// Under the composer, as one pill. A pick is typed as the command with what it takes (`/effort high`), which
// opens no dialog.
export function SessionPill(props: SessionPillProps) {
  const u = props.usage ?? {};
  const figure = pillFigure(u);
  if (props.fixed)
    return (
      <div className="pill">
        <span className="pill-part" aria-label={t.modelIs(u.model ?? t.unknown)}>{u.model ?? t.model}</span>
        {u.effort && (
          <>
            <span className="pill-sep" aria-hidden>·</span>
            <span className="pill-part" aria-label={t.effortIs(effortName(u.effort))}>{effortName(u.effort)}</span>
          </>
        )}
        {figure && <UsageKey usage={u} figure={figure} account={props.account} />}
      </div>
    );
  return (
    <div className="pill">
      <KeyMenu
        label={u.model ?? t.model}
        ariaLabel={t.modelIs(u.model ?? t.unknown)}
        items={modelItems(props.models, u.model).map((m) => ({ ...m, pick: () => props.onCommand(m.command) }))}
      />
      <span className="pill-sep" aria-hidden>·</span>
      <ModeKey mode={props.mode} switching={props.switching} onMode={props.onMode} />
      {u.effort && (
        <>
          <span className="pill-sep" aria-hidden>·</span>
          <KeyMenu
            label={effortName(u.effort)}
            ariaLabel={t.effortIs(effortName(u.effort))}
            items={effortsOf(props.models, u.model).map((level) => ({ label: effortName(level), current: level === u.effort, pick: () => props.onCommand(`/effort ${level}`) }))}
          />
        </>
      )}
      {figure && <UsageKey usage={u} figure={figure} account={props.account} />}
    </div>
  );
}

const COPIED_MS = 1500;

// The context used, or a limit running out, shown in the pill (usage.ts); a tap opens what else the session
// has used.
function UsageKey({ usage: u, figure, account }: { usage: Usage; figure: PillFigure; account?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = usageLines(u, undefined, account);
  const copy = () =>
    void navigator.clipboard
      ?.writeText(usageText(u, lines))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
      });
  return (
    <KeyMenu
      label={figure.label}
      ariaLabel={figure.accessibilityLabel}
      className={figure.high ? 'pill-ctx high' : 'pill-ctx'}
    >
      {() => (
        <div className="usage-menu">
          {lines.map((l) => (
            <div key={l.label} className="usage-menu-row">
              <span>{l.label}</span>
              <span className={l.high ? 'usage-menu-value high' : 'usage-menu-value'}>
                {l.value}
                {l.sub && <small>{l.sub}</small>}
              </span>
            </div>
          ))}
          <button className="key-menu-item" {...press(copy)}>
            <span>{copied ? t.copied : t.copyUsage}</span>
          </button>
        </div>
      )}
    </KeyMenu>
  );
}
