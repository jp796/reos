/**
 * EncryptionService
 *
 * Rewritten from the architecture artifact. The original used
 * `crypto.createCipher` / `createDecipher` (deprecated, no IV support, unsafe)
 * and called `setAAD` / `setAuthTag` on those APIs which throws at runtime.
 *
 * This implementation:
 *  - AES-256-GCM with `createCipheriv` / `createDecipheriv`
 *  - Unique 12-byte IV per encryption (GCM standard)
 *  - Unique 16-byte salt per encryption; key derived via scrypt
 *  - Auth tag stored and verified (tamper detection)
 *  - Output format:  base64(salt) . base64(iv) . base64(tag) . base64(ciphertext)
 *
 * The ENCRYPTION_KEY env var is a 64-hex-char (32-byte) master secret.
 * Generate with:  openssl rand -hex 32
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended
const SALT_LEN = 16;
const TAG_LEN = 16;
const SCRYPT_N = 1 << 14; // 16384 — fast enough for per-call, still strong
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export class EncryptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EncryptionError";
  }
}

export class EncryptionService {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    const keyHex = masterKeyHex ?? process.env.ENCRYPTION_KEY;
    if (!keyHex) {
      throw new EncryptionError(
        "ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.",
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      throw new EncryptionError(
        "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).",
      );
    }
    this.masterKey = Buffer.from(keyHex, "hex");
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== "string") {
      throw new EncryptionError("encrypt() expects a string");
    }
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = scryptSync(this.masterKey, salt, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      salt.toString("base64"),
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }

  decrypt(envelope: string): string {
    if (typeof envelope !== "string" || envelope.length === 0) {
      throw new EncryptionError("decrypt() expects a non-empty string");
    }
    const parts = envelope.split(".");
    if (parts.length !== 4) {
      throw new EncryptionError(
        `Invalid envelope: expected 4 segments, got ${parts.length}`,
      );
    }
    const [saltB64, ivB64, tagB64, ctB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");

    if (salt.length !== SALT_LEN) {
      throw new EncryptionError(`Invalid salt length: ${salt.length}`);
    }
    if (iv.length !== IV_LEN) {
      throw new EncryptionError(`Invalid IV length: ${iv.length}`);
    }
    if (tag.length !== TAG_LEN) {
      throw new EncryptionError(`Invalid auth tag length: ${tag.length}`);
    }

    const key = scryptSync(this.masterKey, salt, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (err) {
      throw new EncryptionError("Decryption failed (tampered or wrong key)", err);
    }
  }

  /**
   * Constant-time comparison helper for secrets (webhook secrets, API keys).
   */
  static constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}

/**
 * Process-wide singleton. Lazy so that tests can construct their own instance
 * with a specific master key.
 */
let _instance: EncryptionService | null = null;
export function getEncryptionService(): EncryptionService {
  if (!_instance) _instance = new EncryptionService();
  return _instance;
}
