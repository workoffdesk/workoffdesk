// First: it hands the chosen language to @workoffdesk/i18n before the pages load it.
import './looks';
import { lazy, StrictMode, Suspense, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Login } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { Settings } from './pages/Settings';
import { Mac } from './pages/Mac';
import { SessionPage } from './pages/Session';
import { MacConversation } from './pages/MacConversation';
import type { Agent } from './api';
import { keepFresh, useBehind } from './freshness';
import { registerServiceWorker } from './push';
import { applyTextSize } from './textSize';
import { usePath } from './router';
import './styles.css';
import { lang, t } from '@workoffdesk/i18n';

// Offered, never forced, so nothing is lost mid-sentence.
function UpdateOffer() {
  return useBehind() ? (
    <button className="update-offer" onClick={() => location.reload()}>
      {t.updateReady}
    </button>
  ) : null;
}

// From this wide, the list stays on the left and the session opens beside it.
const WIDE = '(min-width: 900px)';
const onWideChange = (changed: () => void) => {
  const m = matchMedia(WIDE);
  m.addEventListener('change', changed);
  return () => m.removeEventListener('change', changed);
};
const useWide = () => useSyncExternalStore(onWideChange, () => matchMedia(WIDE).matches);

function Page() {
  const path = usePath();
  const wide = useWide();
  if (path === '/login') return <Login />;
  if (path === '/settings') return <Settings />;
  if (path === '/mac') return <Mac />;
  const term = path.match(/^\/m\/[^/]+\/s\/([a-z0-9]+)$/)?.[1];
  const mac = path.match(/^\/(claude|codex)\/([0-9a-f-]{36})$/);
  const onMac = mac ? { agent: mac[1] as Agent, sid: mac[2] } : null;
  const open = term ? <SessionPage key={term} id={term} /> : onMac ? <MacConversation key={path} {...onMac} /> : null;
  if (!wide) return open ?? <Sessions />;
  return (
    <div className="split">
      <div className="split-list">
        <Sessions current={term ?? onMac?.sid} />
      </div>
      <div className="split-pane">{open ?? <p className="split-empty muted">{t.chooseSession}</p>}</div>
    </div>
  );
}

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
applyTextSize();
// The setup wizard serves this build on its own, short-lived server (workoffdesk setup --web): no service
// worker or update check there, and no other page.
const wizard = location.pathname === '/setup';
const Setup = lazy(() => import('./pages/Setup').then((m) => ({ default: m.Setup })));
if (!wizard) {
  registerServiceWorker();
  keepFresh();
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {wizard ? (
      <Suspense>
        <Setup />
      </Suspense>
    ) : (
      <>
        <Page />
        <UpdateOffer />
      </>
    )}
  </StrictMode>,
);
