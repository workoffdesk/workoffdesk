import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { m } from './messages.js';
import { writeJsonAtomic } from './paths.js';

export type Config = { port: number; origin: string; rpId: string; pinnedDirs: string[]; serviceLabel: string; claudeArgs: string[]; preventSleep: boolean };

export const DEFAULT_PORT = 7681;
export const DEFAULT_SERVICE_LABEL = 'local.workoffdesk';

export class ConfigError extends Error {
  constructor(
    readonly field: string,
    readonly expected: string,
  ) {
    super(m.config.wrong(field, expected));
  }
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function originUrl(origin: unknown): URL | null {
  if (typeof origin !== 'string') return null;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' || LOCAL.test(origin)) ? url : null;
  } catch {
    return null;
  }
}

export function parseConfig(raw: unknown): Config {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const url = originUrl(r.origin);
  if (!url) throw new ConfigError('origin', m.config.origin);
  const port = r.port ?? DEFAULT_PORT;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('port', m.config.port);
  const rpId = r.rpId ?? url.hostname;
  if (typeof rpId !== 'string' || !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))) {
    throw new ConfigError('rpId', m.config.rpId(url.hostname));
  }
  const pinnedDirs = r.pinnedDirs ?? [];
  if (!isStrings(pinnedDirs)) throw new ConfigError('pinnedDirs', m.config.pinnedDirs);
  const serviceLabel = r.serviceLabel ?? DEFAULT_SERVICE_LABEL;
  if (typeof serviceLabel !== 'string' || !/^[A-Za-z0-9.-]+$/.test(serviceLabel)) {
    throw new ConfigError('serviceLabel', m.config.serviceLabel);
  }
  const claudeArgs = r.claudeArgs ?? [];
  if (!isStrings(claudeArgs)) throw new ConfigError('claudeArgs', m.config.claudeArgs);
  const preventSleep = r.preventSleep ?? true;
  if (typeof preventSleep !== 'boolean') throw new ConfigError('preventSleep', m.config.preventSleep);
  return { port, origin: url.origin, rpId, pinnedDirs, serviceLabel, claudeArgs, preventSleep };
}

export function loadConfig(home: string): Config {
  const file = join(home, 'config.json');
  if (!existsSync(file)) throw new ConfigError('origin', m.config.missing(file));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(m.config.format, m.config.notJson((e as Error).message));
  }
  return parseConfig(raw);
}

export function writeConfig(home: string, c: Config): void {
  writeJsonAtomic(join(home, 'config.json'), c);
}
