import type { MacCheck } from '@workoffdesk/client/mac/macPage';
import { t } from '@workoffdesk/i18n';
import { useCopied } from '@workoffdesk/react/copied';

// One of the Mac's checks, with its fix, which copies on a tap.
export function CheckRow({ check }: { check: MacCheck }) {
  const [copied, setCopied] = useCopied();
  const copy = () => navigator.clipboard?.writeText(check.fix!).then(() => setCopied(true), () => {});
  return (
    <div className="row mac-check" data-testid="mac-check">
      <span className={`mac-dot ${check.ok ? 'ok' : 'bad'}`} aria-label={check.ok ? t.macCheckPassed : t.macCheckFailed} />
      <div className="row-main">
        <strong>{t.checkNames[check.id] ?? check.id}</strong>
        <span>{check.detail}</span>
        {check.fix && (
          <button className="mac-fix" onClick={copy} title={t.macFixTap}>
            <code>{check.fix}</code>
            <em>{copied ? t.copied : t.macFixTap}</em>
          </button>
        )}
      </div>
    </div>
  );
}
