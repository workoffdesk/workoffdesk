import type { Api } from '@workoffdesk/client/base/api';
import { createProjectSearch } from '@workoffdesk/client/sessions/projectSearch';
import { useEffect, useMemo, useState } from 'react';
import { useFetched } from './fetched';
import { useStore } from './store';

const loadProjects = (api: Api) => api<string[]>('/api/claude/projects');

// The projects a new session can open in: those Claude Code knows, searched as the box is typed in.
export function useProjectSearch(api: Api) {
  const load = useMemo(() => () => loadProjects(api), [api]);
  const { data, error } = useFetched(load);
  const search = useMemo(() => createProjectSearch(api), [api]);
  useEffect(() => search.hold(), [search]);
  useEffect(() => search.setKnown(data), [search, data]);
  const found = useStore(search);
  const [box, setBox] = useState('');
  const type = (text: string) => {
    setBox(text);
    search.type(text);
  };
  // A path is opened as typed; a search opens the project it found first.
  const chosen = found.path ? found.text : found.rows?.[0];
  return { data, error, found, box, type, chosen };
}
