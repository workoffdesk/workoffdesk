import { createDecipheriv, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seal, threadOf } from '../../../src/notify/seal.js';

const key = Buffer.alloc(32, 7).toString('base64');

// What the phone's extension does with CryptoKit's AES.GCM.SealedBox(combined:): nonce, ciphertext, tag.
function open(keyB64: string, sealed: string): unknown {
  const box = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), box.subarray(0, 12));
  d.setAuthTag(box.subarray(box.length - 16));
  return JSON.parse(Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]).toString('utf8'));
}

describe('seal', () => {
  const said = { alert: { title: 'proj', subtitle: '需要你', body: 'Which one?' }, sessionId: 's1' };

  it('seals what only the key opens, in the layout the phone reads', () => {
    expect(open(key, seal(key, said))).toEqual(said);
    expect(() => open(Buffer.alloc(32, 8).toString('base64'), seal(key, said))).toThrow();
  });

  it('never seals the same thing the same way twice', () => {
    const a = seal(key, said);
    const b = seal(key, said);
    expect(a).not.toEqual(b);
    expect(Buffer.from(a, 'base64').subarray(0, 12)).not.toEqual(Buffer.from(b, 'base64').subarray(0, 12));
  });

  it('says which notifications go together without naming the session', () => {
    const t = threadOf(key, 's1');
    expect(t).toMatch(/^[0-9a-f]{16}$/);
    expect(t).toBe(createHmac('sha256', Buffer.from(key, 'base64')).update('s1').digest('hex').slice(0, 16));
    expect(threadOf(key, 's2')).not.toBe(t);
  });
});
