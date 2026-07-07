#!/usr/bin/env node
// Standalone CLI mirroring the AES-256-GCM envelope used by
// apps/api/src/services/config-service.ts (encryptSecret/decryptSecret):
// `iv:authTag:ciphertext`, all hex, 12-byte IV, aes-256-gcm.
//
// scripts/restore-drill.sh shells out to this so the restore drill can prove
// a restored `config_entry.encryptedValue` decrypts with the real
// CONFIG_ENCRYPTION_SECRET (and correctly fails with the wrong one) without
// needing a full API build. If apps/api/src/services/config-service.ts ever
// changes its envelope format, update both places — there is no shared
// package to import from a shell script.
//
// Usage:
//   node restore-drill-crypto.mjs encrypt <plaintext> <hexSecret>
//   node restore-drill-crypto.mjs decrypt <ivHex:authTagHex:cipherHex> <hexSecret>
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const CIPHER_ALGO = 'aes-256-gcm'

function parseKey(secret) {
  return Buffer.from(secret, 'hex')
}

function encryptSecret(plainText, encryptionSecret) {
  const key = parseKey(encryptionSecret)
  const iv = randomBytes(12)
  const cipher = createCipheriv(CIPHER_ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptSecret(encryptedValue, encryptionSecret) {
  const key = parseKey(encryptionSecret)
  const parts = encryptedValue.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted value format')
  const [ivHex, authTagHex, cipherHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(cipherHex, 'hex')
  const decipher = createDecipheriv(CIPHER_ALGO, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

const [, , mode, arg1, arg2] = process.argv

if (mode === 'encrypt') {
  process.stdout.write(encryptSecret(arg1, arg2))
} else if (mode === 'decrypt') {
  try {
    process.stdout.write(decryptSecret(arg1, arg2))
  } catch (err) {
    process.stderr.write(`decrypt failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
} else {
  process.stderr.write('Usage: restore-drill-crypto.mjs <encrypt|decrypt> <value> <hexSecret>\n')
  process.exit(2)
}
