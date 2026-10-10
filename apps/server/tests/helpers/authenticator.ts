import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

// A passkey held in software: what a phone's authenticator answers to the options a server sends,
// signed with an ES256 key of its own and attested with "none".
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export interface Ceremony {
  origin: string;
  rpId: string;
  challenge: string;
  // Leave out user verification, as an authenticator that only checks presence does.
  noUv?: boolean;
}

export class Authenticator {
  constructor(
    readonly id = b64url(randomBytes(16)),
    private readonly key = generateKeyPairSync('ec', { namedCurve: 'P-256' }),
    private counter = 0,
  ) {}

  // Under the same credential id, a key of its own: what a forged passkey would be.
  forged(): Authenticator {
    return new Authenticator(this.id);
  }

  // The same key, its counter where this one's is now: what a copied passkey would be.
  copied(): Authenticator {
    return new Authenticator(this.id, this.key, this.counter);
  }

  register(c: Ceremony) {
    const jwk = this.key.publicKey.export({ format: 'jwk' });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]);
    const credId = Buffer.from(this.id, 'base64url');
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credId.length);
    const authData = Buffer.concat([this.authData(c, AT), Buffer.alloc(16), length, credId, isoCBOR.encode(cose)]);
    const attestation = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', c)),
        attestationObject: b64url(attestation),
        transports: ['internal' as const],
      },
      clientExtensionResults: {},
    };
  }

  login(c: Ceremony) {
    this.counter += 1;
    const authData = this.authData(c, 0);
    const clientData = this.clientData('webauthn.get', c);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.key.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    };
  }

  private authData(c: Ceremony, flags: number): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(c.rpId), Buffer.from([UP | (c.noUv ? 0 : UV) | flags]), count]);
  }

  private clientData(type: string, c: Ceremony): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge: c.challenge, origin: c.origin, crossOrigin: false }));
  }
}
