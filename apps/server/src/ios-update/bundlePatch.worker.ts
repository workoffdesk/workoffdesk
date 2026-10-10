import { parentPort, workerData } from 'node:worker_threads';
import { loadBsdiff } from 'bsdiff-wasm';

// bsdiff takes about a second of CPU on a 4.5 MB bundle, so it runs here rather than on the server's thread.
const { base, target } = workerData as { base: Uint8Array; target: Uint8Array };
const bsdiff = await loadBsdiff();
bsdiff.FS.writeFile('/base', base);
bsdiff.FS.writeFile('/target', target);
const code = bsdiff.callMain(['/base', '/target', '/patch']);
if (code !== 0) throw new Error(`bsdiff exited with ${code}`);
parentPort!.postMessage(bsdiff.FS.readFile('/patch'));
