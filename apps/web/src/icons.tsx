const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconBack = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconForward = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
);
export const IconGear = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const IconTerminal = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></svg>
);
export const IconCode = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>
);
export const IconChat = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>
);
// SF Symbols desktopcomputer, as the phone has it.
export const IconDesktop = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></svg>
);
export const IconFolder = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
// The marks the phone's new-session screen has: SF Symbols bubble.left, clock.arrow.circlepath and terminal.
export const IconBubble = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
export const IconHistory = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" /><path d="M3 3.5v4.8h4.8" /><path d="M12 7.5V12l3.5 2" /></svg>
);
export const IconConsole = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><rect x="2.5" y="4.5" width="19" height="15" rx="3" /><path d="M6.5 9.5l2.5 2.5-2.5 2.5M11.5 15h5" /></svg>
);
export const IconCheck = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export const IconClose = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
);
export const IconFace = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2" />
    <path d="M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.3 4.4 1.3 6 0" />
  </svg>
);
export const IconImage = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);
export const IconCamera = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);
export const IconDoc = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const IconPlay = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
);
export const IconDown = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M12 5v14M6 13l6 6 6-6" /></svg>
);
export const IconUp = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
export const IconPlus = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMore = () => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2.6} aria-hidden><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
);
export const IconSearch = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
);
export const IconText = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden><path d="M5 7h14M5 12h14M5 17h9" /></svg>
);

export const IconKeys = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </svg>
);
