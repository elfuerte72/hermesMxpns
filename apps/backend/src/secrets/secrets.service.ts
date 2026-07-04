import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = 'v1:';

@Injectable()
export class SecretsService {
  private readonly key: Buffer;

  constructor(encryptionKeyHex: string) {
    const key = Buffer.from(encryptionKeyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    if (!payload.startsWith(PREFIX)) {
      throw new Error('Unsupported ciphertext format');
    }
    const blob = Buffer.from(payload.slice(PREFIX.length), 'base64');
    if (blob.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Ciphertext too short');
    }
    const iv = blob.subarray(0, IV_LENGTH);
    const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
