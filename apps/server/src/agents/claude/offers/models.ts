import { initialized } from './initialize.js';

// A model /model takes, as Claude Code lists it for this account. value: what /model is given; efforts: the
// levels /effort takes with it, none when it takes none.
export type ModelChoice = { value: string; name: string; about: string; efforts: string[] };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
// What /model is given is typed at the prompt: a name, an id, `opus[1m]`, never anything else.
const VALUE = /^[\w.:[\]-]{1,40}$/;

// The models Claude Code offers in `cwd`, in its own order; empty when it cannot be asked.
export async function listModels(bin: string, cwd: string): Promise<ModelChoice[]> {
  const told = await initialized(bin, cwd).catch(() => null);
  if (!Array.isArray(told?.models)) return [];
  return told.models.flatMap((m: unknown): ModelChoice[] => {
    if (!m || typeof m !== 'object') return [];
    const r = m as Record<string, unknown>;
    const value = str(r.value);
    if (!VALUE.test(value)) return [];
    const efforts = r.supportsEffort === true && Array.isArray(r.supportedEffortLevels) ? r.supportedEffortLevels.filter((l): l is string => typeof l === 'string') : [];
    return [{ value, name: str(r.displayName) || value, about: str(r.description), efforts }];
  });
}
