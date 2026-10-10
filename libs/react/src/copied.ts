import { useEffect, useState } from 'react';

// Whether something was just copied: it says so for a moment, then goes back.
export function useCopied(): [boolean, (copied: boolean) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return [copied, setCopied];
}
