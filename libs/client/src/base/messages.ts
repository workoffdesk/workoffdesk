// A name for a message, so one sent again after its answer was lost is taken once (the server takes
// 8-64 of [A-Za-z0-9_-]). The bytes come from the platform's secure random source.
export const MESSAGE_ID_BYTES = 8;
export const messageId = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
