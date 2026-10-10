// A session's tmux session is named for it, so the sessions this server runs are told apart from any other
// on the same tmux server.
const PREFIX = 'wod-';

export const tmuxName = (id: string): string => PREFIX + id;

export function idOfTmuxName(name: string): string | undefined {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : undefined;
}
