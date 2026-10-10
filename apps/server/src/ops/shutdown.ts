// What a signal handler runs: close everything once, then exit 0; exit 1 if closing fails or takes
// longer than the limit, so a supervisor is never left waiting on a server that will not stop.
export function shutdownOnce(close: () => Promise<void>, o: { timeoutMs: number; exit: (code: number) => void }): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    setTimeout(() => o.exit(1), o.timeoutMs).unref();
    close().then(
      () => o.exit(0),
      () => o.exit(1),
    );
  };
}
