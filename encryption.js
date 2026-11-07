
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey() {
  const encoded = process.env.FIELD_ENCRYPTION_KEY;

  if (!encoded) {
    throw new Error('FIELD_ENCRYPTION_KEY is missing');
  }

  const key = Buffer.from(encoded, 'base64');

  if (
    key.length !== 32 ||
    key.toString('base64') !== encoded
  ) {
    throw new Error('Invalid FIELD_ENCRYPTION_KEY');
  }

  return key;
}

function encrypt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TypeError('Value must be a string');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64')
  ].join(':');
}

function decrypt(encryptedValue) {
  if (encryptedValue === null || encryptedValue === undefined) {
    return null;
  }

  if (typeof encryptedValue !== 'string') {
    throw new TypeError('Invalid encrypted value');
  }

  const parts = encryptedValue.split(':');

  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted value format');
  }

  const [, ivText, tagText, ciphertextText] = parts;

  function decode(text) {
    const buffer = Buffer.from(text, 'base64');

    if (buffer.toString('base64') !== text) {
      throw new Error('Invalid encrypted value encoding');
    }

    return buffer;
  }

  const iv = decode(ivText);
  const tag = decode(tagText);
  const ciphertext = decode(ciphertextText);

  if (iv.length !== IV_LENGTH || tag.length !== 16) {
    throw new Error('Invalid encrypted value');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    iv
  );

  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  encrypt,
  decrypt
};
