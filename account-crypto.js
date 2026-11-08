
const crypto = require('node:crypto');

function getKey() {
  const hex = process.env.ACCOUNT_ENCRYPTION_KEY || '';

  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'ACCOUNT_ENCRYPTION_KEY must be 64 hexadecimal characters'
    );
  }

  return Buffer.from(hex, 'hex');
}

function encryptAccountNumber(value) {
  if (!value) return '';

  if (!/^\d{6,34}$/.test(value)) {
    throw new Error('Invalid full account number');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    getKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    'enc1',
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex')
  ].join(':');
}

function decryptAccountNumber(value) {
  if (!value) return '';

  const parts = String(value).split(':');

  if (parts.length !== 4 || parts[0] !== 'enc1') {
    throw new Error('Unsupported account number format');
  }

  const [, ivHex, tagHex, dataHex] = parts;

  if (
    !/^[0-9a-f]{24}$/i.test(ivHex) ||
    !/^[0-9a-f]{32}$/i.test(tagHex) ||
    !/^(?:[0-9a-f]{2})+$/i.test(dataHex)
  ) {
    throw new Error('Invalid encrypted account number');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  encryptAccountNumber,
  decryptAccountNumber
};
