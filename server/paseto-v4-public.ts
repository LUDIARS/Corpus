// PASETO v4.public (Ed25519) の署名検証だけを行う最小実装。
//
// Cernere は `paseto` ライブラリ (V4.sign、 footer に {"kid"}) で service token を署名する。
// Corpus は検証しか要らないので依存を足さず node:crypto で PAE を組んで検証する
// (PASETO spec v4.public: sig over PAE("v4.public.", m, f, i)、 implicit assertion i は空)。
// GLAB plugins/projects/paseto-v4-public.ts と同じ実装。 claims の意味の判定はここでは行わない。

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

const HEADER = 'v4.public.';
const SIGNATURE_BYTES = 64;
/** raw 32 byte の Ed25519 公開鍵を SPKI DER にする接頭辞。 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface PasetoVerifyKey {
  kid: string;
  /** raw 32 byte Ed25519 公開鍵 (Cernere `/.well-known/cernere-public-key` の public_key を base64 復号したもの)。 */
  publicKey: Buffer;
}

interface ParsedToken {
  message: Buffer;
  signature: Buffer;
  footer: Buffer;
}

export function ed25519PublicKey(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/**
 * 署名が鍵のいずれかで検証できた場合だけ claims を返す。 footer に kid があれば
 * その鍵を優先し、 無ければ全鍵を試す (Cernere の鍵ローテーション中は新旧が並ぶ)。
 */
export function verifyPasetoV4Public(token: string, keys: readonly PasetoVerifyKey[]): Record<string, unknown> | null {
  const parsed = parse(token);
  if (!parsed) return null;
  const kid = footerKid(parsed.footer);
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  const signed = pae([Buffer.from(HEADER), parsed.message, parsed.footer, Buffer.alloc(0)]);
  for (const key of candidates) {
    if (key.publicKey.length !== 32) continue;
    if (verify(null, signed, ed25519PublicKey(key.publicKey), parsed.signature)) {
      return parseClaims(parsed.message);
    }
  }
  return null;
}

/** footer の kid (Cernere は `{"kid":"v1"}` を載せる)。 無ければ null。 */
export function pasetoFooterKid(token: string): string | null {
  const parsed = parse(token);
  return parsed ? footerKid(parsed.footer) : null;
}

function parse(token: string): ParsedToken | null {
  if (!token.startsWith(HEADER)) return null;
  const parts = token.slice(HEADER.length).split('.');
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return null;
  const body = Buffer.from(parts[0], 'base64url');
  if (body.length <= SIGNATURE_BYTES) return null;
  return {
    message: body.subarray(0, body.length - SIGNATURE_BYTES),
    signature: body.subarray(body.length - SIGNATURE_BYTES),
    footer: parts[1] ? Buffer.from(parts[1], 'base64url') : Buffer.alloc(0),
  };
}

function parseClaims(message: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(message.toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function footerKid(footer: Buffer): string | null {
  if (footer.length === 0) return null;
  try {
    const value = JSON.parse(footer.toString('utf8')) as { kid?: unknown };
    return typeof value.kid === 'string' && value.kid ? value.kid : null;
  } catch {
    return null;
  }
}

/** PASETO Pre-Authentication Encoding。 */
function pae(pieces: Buffer[]): Buffer {
  return Buffer.concat([le64(pieces.length), ...pieces.flatMap((piece) => [le64(piece.length), piece])]);
}

function le64(n: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n) & 0x7fffffffffffffffn);
  return out;
}
