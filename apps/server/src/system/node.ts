// @fastify/static loads ESM-only dependencies through require(); SQLite is built in from 22.13 (journal/).
export const MIN_NODE = [22, 13];

export function nodeTooOld(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]);
}
