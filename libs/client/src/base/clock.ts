// How far the Mac's clock is ahead of this device's, from the Date its answers carry: a phone's clock can be
// a minute out, and what the Mac stamps is shown against it.
let ahead = 0;

// An answer that left at sent and came at got, by this device's clock, said it was date. Date is to the
// second, so its middle is taken.
export function heardDate(date: string | null, sent: number, got: number): void {
  const at = date ? Date.parse(date) : NaN;
  if (!Number.isNaN(at)) ahead = at + 500 - (sent + got) / 2;
}

// A time on the Mac's clock, on this device's.
export const onThisClock = (macMs: number) => macMs - ahead;
