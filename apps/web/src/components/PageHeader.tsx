import { t } from '@workoffdesk/i18n';
import type { ReactNode } from 'react';
import { IconBack } from '../icons';

// The header of a page under the list, as the phone's (apps/mobile/src/components/header.tsx): back on the left,
// the title in the middle, anything else on the right, on the surface with a hairline under it.
export function PageHeader({ title, onBack, right }: { title: ReactNode; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="pagebar">
      <button className="pagebar-back" aria-label={t.back} onClick={onBack}>
        <IconBack />
      </button>
      <h1>{title}</h1>
      <div className="pagebar-right">{right}</div>
    </header>
  );
}
