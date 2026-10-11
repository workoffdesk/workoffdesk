import { t } from '@workoffdesk/i18n';
import { useMacHistory } from '@workoffdesk/react/macHistory';
import { useEffect, useRef } from 'react';
import { api } from '../api';
import { MacItem } from '../components/MacItem';
import { PageHeader } from '../components/PageHeader';
import { IconSearch } from '../icons';
import { navigate } from '../router';

// Every Claude and Codex conversation on the Mac that no session here holds, by day, searched as it is typed;
// more come as the list is scrolled to its end. A row opens the conversation to read before picking it up.
export function Conversations({ current }: { current?: string }) {
  const { history, days, rows, q, loading, error, more } = useMacHistory(api);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = end.current;
    if (!at || !more) return;
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && history.loadMore(), { rootMargin: '400px' });
    seen.observe(at);
    return () => seen.disconnect();
  }, [history, more, rows.length]);
  return (
    <main className="list-page">
      <PageHeader title={t.conversationsOnMac} onBack={() => navigate('/')} />
      {days.map((d) => (
        <div key={d.title} className="sess-list">
          <h2 className="sess-group">{d.title}</h2>
          {d.rows.map((r) => (
            <MacItem key={r.sessionId} r={r} current={r.sessionId === current} />
          ))}
        </div>
      ))}
      {!loading && !error && rows.length === 0 && <p className="muted center">{q.trim() ? t.notFound(q.trim()) : t.noConversations}</p>}
      {loading && <p className="muted center">{t.loading}</p>}
      {error && (
        <p className="center">
          <span className="alert">{error}</span>{' '}
          <button className="btn small" onClick={() => (rows.length ? history.loadMore() : history.reload())}>
            {t.tryAgain}
          </button>
        </p>
      )}
      <div ref={end} />
      <label className="list-search">
        <IconSearch />
        <input type="search" aria-label={t.search} placeholder={t.search} defaultValue={q} onChange={(e) => history.search(e.target.value)} enterKeyHint="search" />
      </label>
    </main>
  );
}
