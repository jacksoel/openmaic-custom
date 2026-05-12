/**
 * Encryption utilities for per-user API keys
 *
 * Uses AES-256-GCM with a server-side encryption key.
 * This module is server-only (uses Node.js crypto).
 */

const ENCRYPTION_KEY = process.env.USER_KEYS_ENCRYPTION_KEY || '';

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error('USER_KEYS_ENCRYPTION_KEY env var is required for per-user provider keys');
  }
  // Derive a stable 32-byte key via SHA-256 so the full entropy of the env var is used,
  // regardless of its length or encoding. Safe to rotate: change env var + re-encrypt all rows.
  const { createHash } = require('crypto');
  return createHash('sha256').update(ENCRYPTION_KEY).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const crypto = require('crypto');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptApiKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  const crypto = require('crypto');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
