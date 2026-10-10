// Polls, so a passing test waits only as long as it must; the limit leaves room for a loaded machine
// and stays under the 20 s a test gets.
export async function until(fn: () => boolean | Promise<boolean>, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
