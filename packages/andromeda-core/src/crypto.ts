// Ed25519 keypair + signing primitives.
//
// Wraps @noble/ed25519 v2 (async surface) with a hex-string API so the
// rest of the codebase doesn't have to think about Uint8Array vs hex.

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

// noble v2 ships pure-async by default; wire the sha512 sync hook so
// the sync getPublicKey is available too. Async path also works without
// this, but having sync is convenient for tests.
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const concat = ed.etc.concatBytes(...msgs);
  return sha512(concat);
};

const HEX_RX = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array {
  if (!HEX_RX.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

export type Keypair = {
  /** 32-byte private seed, hex-encoded. */
  privkey_hex: string;
  /** 32-byte Ed25519 public key, hex-encoded. */
  pubkey_hex: string;
};

/** Generate a new Ed25519 keypair using OS randomness. */
export async function generateKeypair(): Promise<Keypair> {
  const sk = ed.utils.randomPrivateKey();
  const pk = await ed.getPublicKeyAsync(sk);
  return { privkey_hex: bytesToHex(sk), pubkey_hex: bytesToHex(pk) };
}

/** Derive the public key for an existing private seed. */
export async function pubkeyFor(privkeyHex: string): Promise<string> {
  const sk = hexToBytes(privkeyHex);
  if (sk.length !== 32) throw new Error("private key must be 32 bytes (64 hex chars)");
  const pk = await ed.getPublicKeyAsync(sk);
  return bytesToHex(pk);
}

/** Sign an arbitrary message; returns a 64-byte hex signature. */
export async function sign(messageHex: string, privkeyHex: string): Promise<string> {
  const sig = await ed.signAsync(hexToBytes(messageHex), hexToBytes(privkeyHex));
  return bytesToHex(sig);
}

/** Verify a signature; never throws. */
export async function verify(
  messageHex: string,
  signatureHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  try {
    if (signatureHex.length !== 128) return false;
    if (pubkeyHex.length !== 64) return false;
    return await ed.verifyAsync(
      hexToBytes(signatureHex),
      hexToBytes(messageHex),
      hexToBytes(pubkeyHex),
    );
  } catch {
    return false;
  }
}

/** Convenience: sign UTF-8 string. */
export async function signUtf8(message: string, privkeyHex: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  return sign(bytesToHex(bytes), privkeyHex);
}

/** Convenience: verify UTF-8 string. */
export async function verifyUtf8(
  message: string,
  signatureHex: string,
  pubkeyHex: string,
): Promise<boolean> {
  const bytes = new TextEncoder().encode(message);
  return verify(bytesToHex(bytes), signatureHex, pubkeyHex);
}

export { hexToBytes, bytesToHex };
