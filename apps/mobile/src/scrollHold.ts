// A list held still while any of its rows is slid sideways: iOS scrolls the list under a finger that a row has
// taken, unless the list is told not to. Each hold returns its let-go, which does nothing the second time.
export function scrollHolds(onChange: (held: boolean) => void): () => () => void {
  let holding = 0;
  return () => {
    if (++holding === 1) onChange(true);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--holding === 0) onChange(false);
    };
  };
}
