import type { Limit } from '../../system/store.js';

// What Claude Code's status line reports of a session: how full its context is and how much of the plan's
// limits it has used. Each field is left out when the status line does not give it in the shape expected.
export type Usage = {
  model?: string;
  effort?: string;
  context?: number;
  fiveHour?: Limit;
  sevenDay?: Limit;
  cost?: number;
  added?: number;
  removed?: number;
};

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const pct = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.min(100, n);
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v.slice(0, 80) : undefined);

function limit(v: unknown): Limit | undefined {
  const o = obj(v);
  const used = pct(o?.used_percentage);
  if (used === undefined) return undefined;
  // Unix seconds.
  const resetsAt = num(o?.resets_at);
  return resetsAt === undefined ? { used } : { used, resetsAt };
}

export function usageFrom(payload: unknown): Usage | null {
  const p = obj(payload);
  if (!p) return null;
  const model = obj(p.model);
  const cost = obj(p.cost);
  const limits = obj(p.rate_limits);
  const u: Usage = {
    model: str(model?.display_name) ?? str(model?.id) ?? str(p.model),
    effort: str(obj(p.effort)?.level),
    context: pct(obj(p.context_window)?.used_percentage),
    fiveHour: limit(limits?.five_hour),
    sevenDay: limit(limits?.seven_day),
    cost: num(cost?.total_cost_usd),
    added: num(cost?.total_lines_added),
    removed: num(cost?.total_lines_removed),
  };
  const kept = Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) as Usage;
  return Object.keys(kept).length ? kept : null;
}
