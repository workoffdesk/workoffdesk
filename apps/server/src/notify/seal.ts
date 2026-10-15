import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

// A notification for the App Store app goes through a relay that must not read it. It is sealed with the key
// the phone gave this server: AES-256-GCM, as nonce, ciphertext and tag one after another, which is how
// CryptoKit's AES.GCM.SealedBox(combined:) in the phone's notification extension reads it.

export function seal(keyB64: string, said: unknown): string {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), nonce);
  const text = Buffer.concat([c.update(JSON.stringify(said), 'utf8'), c.final()]);
  return Buffer.concat([nonce, text, c.getAuthTag()]).toString('base64');
}

// The thread a session's notifications are grouped under, which the relay sees.
export const threadOf = (keyB64: string, sessionId: string): string =>
  createHmac('sha256', Buffer.from(keyB64, 'base64')).update(sessionId).digest('hex').slice(0, 16);
