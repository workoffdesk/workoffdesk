import { loadBspatch } from 'bsdiff-wasm';

// What the phone does with a patch the server sends: bspatch, as expo-updates' bsdiff support does.
export async function applied(base: Buffer, patch: Buffer): Promise<Buffer> {
  const bspatch = await loadBspatch();
  bspatch.FS.writeFile('/base', base);
  bspatch.FS.writeFile('/patch', patch);
  const code = bspatch.callMain(['/base', '/target', '/patch']);
  if (code !== 0) throw new Error(`bspatch exited with ${code}`);
  return Buffer.from(bspatch.FS.readFile('/target'));
}
