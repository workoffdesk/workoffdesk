import { join } from 'node:path';
import { Tmux, writeTmuxConf } from '../../src/system/tmux.js';

// A tmux server of the test file's own, on a socket no other run shares, with the config the server writes.
// The file kills it when its tests are done.
export function testTmux(dir: string, name: string): { tmux: Tmux; socket: string; conf: string } {
  const conf = join(dir, 'tmux.conf');
  writeTmuxConf(conf);
  const socket = `workoffdesk-test-${name}-${process.pid}-${Date.now()}`;
  return { tmux: new Tmux({ socket, conf }), socket, conf };
}
