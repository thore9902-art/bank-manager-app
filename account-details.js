
const pool = require('./db');
const { encrypt, decrypt } = require('./encryption');

async function checkDatabaseConnection() {
  const result = await pool.query('SELECT NOW() AS current_time');
  return result.rows[0].current_time;
}


async function saveAccountDetails(accountId, details) {
  if (
    typeof accountId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)
  ) {
    throw new Error('Invalid account ID');
  }

  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new Error('Invalid account details');
  }

  const fullAccountNumber = details.fullAccountNumber;
  const panNumber = details.panNumber;

  if (
    fullAccountNumber != null &&
    (typeof fullAccountNumber !== 'string' ||
      !/^[0-9]{6,34}$/.test(fullAccountNumber))
  ) {
    throw new Error('Invalid bank account number');
  }

  if (
    panNumber != null &&
    (typeof panNumber !== 'string' ||
      !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber))
  ) {
    throw new Error('Invalid PAN number');
  }

  const encryptedAccountNumber =
    fullAccountNumber == null ? null : encrypt(fullAccountNumber);

  const encryptedPan =
    panNumber == null ? null : encrypt(panNumber);

  const result = await pool.query(
    `INSERT INTO public.bank_account_details
       (id, account_id, full_account_number_encrypted,
        pan_number_encrypted)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING account_id`,
    [accountId, encryptedAccountNumber, encryptedPan]
  );

  return result.rows[0];
}


function maskAccountNumber(value) {
  if (!value) return null;
  return '*'.repeat(Math.max(0, value.length - 4)) +
    value.slice(-4);
}

function maskPanNumber(value) {
  if (!value) return null;
  return '*'.repeat(Math.max(0, value.length - 4)) +
    value.slice(-4);
}

async function getMaskedAccountDetails(accountId) {
  if (
    typeof accountId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)
  ) {
    throw new Error('Invalid account ID');
  }

  const result = await pool.query(
    `SELECT
       account_id,
       full_account_number_encrypted,
       pan_number_encrypted,
       card_holder_name,
       card_type,
       card_last4,
       card_expiry_month,
       card_expiry_year
     FROM public.bank_account_details
     WHERE account_id = $1`,
    [accountId]
  );

  if (result.rows.length === 0) return null;

  const record = result.rows[0];

  const accountNumber = decrypt(
    record.full_account_number_encrypted
  );

  const panNumber = decrypt(
    record.pan_number_encrypted
  );

  return {
    accountId: record.account_id,
    accountNumberMasked: maskAccountNumber(accountNumber),
    panMasked: maskPanNumber(panNumber),
    cardHolderName: record.card_holder_name,
    cardType: record.card_type,
    cardLast4: record.card_last4,
    cardExpiryMonth: record.card_expiry_month,
    cardExpiryYear: record.card_expiry_year
  };
}


module.exports = {
  checkDatabaseConnection,
  saveAccountDetails,
  getMaskedAccountDetails,
  maskAccountNumber,
  maskPanNumber
};
