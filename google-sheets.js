const {
  encryptAccountNumber
} = require('./account-crypto');
require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const { google } = require('googleapis');

const spreadsheetId = process.env.GOOGLE_SHEET_ID;

if (!spreadsheetId) {
  throw new Error('GOOGLE_SHEET_ID is missing from .env');
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    'GOOGLE_APPLICATION_CREDENTIALS is missing from .env'
  );
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});

const sheets = google.sheets({
  version: 'v4',
  auth
});

const HEADERS = [
  'ID',
  'Account Holder',
  'Bank Name',
  'Account Last 4 Digits',
  'IFSC Code',
  'Branch',
  'Account Type',
  'Phone',
  'Updated At',
  'Full Account Number',
  'Card Last 4',
  'Aadhaar Last 4',
  'Masked PAN Reference',
  'Mother Name',
  'Mother Phone',
  'Email',
  'Address',
  'Account Status',
  'Reference',
  'Notes'
];

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headerIndex(headers, name) {
  return headers.findIndex(
    (header) =>
      normalizeHeader(header) === normalizeHeader(name)
  );
}

function assertHeaders(headers) {
  const required = [
    'ID',
    'Account Holder',
    'Bank Name',
    'Account Last 4 Digits',
    'IFSC Code',
    'Branch',
    'Account Type',
    'Updated At',
    'Account Status'
  ];

  const missing = required.filter(
    (name) => headerIndex(headers, name) < 0
  );

  if (missing.length) {
    throw new Error(
      'Accounts sheet missing headings: ' +
      missing.join(', ')
    );
  }
}

async function getRows() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Accounts!A1:T'
  });

  return response.data.values || [];
}

async function getAccounts() {
  const rows = await getRows();

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  assertHeaders(headers);

  const idIndex = headerIndex(headers, 'ID');

  return rows
    .slice(1)
    .filter((row) =>
      String(row[idIndex] || '').trim()
    )
    .map((row) => {
      const account = {};

      HEADERS.forEach((name) => {
        const index = headerIndex(headers, name);

        account[name] = index >= 0
          ? String(row[index] || '')
          : '';
      });

      return account;
    });
}

async function addAccount(data) {
  if (!data || !data.accountHolder || !data.bankName) {
    throw new Error(
      'Account holder and bank name are required'
    );
  }

  const id = data.id || crypto.randomUUID();

 

const record = {
  'ID': id,
  'Account Holder': data.accountHolder,
  'Bank Name': data.bankName,
  'Account Last 4 Digits': data.accountLast4,
  'IFSC Code': data.ifscCode,
  'Branch': data.branch,
  'Account Type': data.accountType,
  'Account Status': data.status,
  'Card Last 4': data.cardLast4,
  'Notes': data.note,
  'Email': data.email,
  'Reference': data.reference,
  'Aadhaar Last 4': data.aadhaarLast4,
  'Masked PAN Reference': data.pan,
  'Mother Name': data.motherName,
  'Full Account Number':
    encryptAccountNumber(data.fullAccountNumber || ''),
  'Updated At': new Date().toISOString()
};


  const row = HEADERS.map(
    (header) => record[header] || ''
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Accounts!A:T',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row]
    }
  });

  return id;
}

// Update an existing account.
// Only the permitted fields are modified.
async function updateAccount(id, data) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Invalid account ID');
    
  }

  const rows = await getRows();

  if (!rows.length) {
    throw new Error('Accounts sheet is empty');
  }

  const headers = rows[0];
  assertHeaders(headers);

  const idIndex = headerIndex(headers, 'ID');
  const matches = [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIndex] || '') === id) {
      matches.push(i + 1);
    }
  }

  if (matches.length === 0) {
    return false;
  }

  if (matches.length !== 1) {
    throw new Error(
      'Duplicate account IDs found. Update refused.'
    );
  }

  const rowNumber = matches[0];
  const existingRow = rows[rowNumber - 1];
const fullNumberColumn = headerIndex(
  headers,
  'Full Account Number'
);

if (fullNumberColumn < 0) {
  throw new Error('Full Account Number column missing');
}

const existingEncryptedNumber =
  String(existingRow[fullNumberColumn] || '');

const encryptedFullNumber = data.fullAccountNumber
  ? encryptAccountNumber(data.fullAccountNumber)
  : existingEncryptedNumber;

  
const updates = [
  ['Account Holder', data.accountHolder],
  ['Bank Name', data.bankName],
  ['Account Last 4 Digits', data.accountLast4],
  ['IFSC Code', data.ifscCode],
  ['Branch', data.branch],
  ['Account Type', data.accountType],
  ['Account Status', data.status],
  ['Card Last 4', data.cardLast4],
  ['Notes', data.note],
  ['Email', data.email],
  ['Reference', data.reference],
  ['Aadhaar Last 4', data.aadhaarLast4],
  ['Masked PAN Reference', data.pan],
  ['Mother Name', data.motherName],
  ['Updated At', new Date().toISOString()]
  ['Full Account Number', encryptedFullNumber],
];


  const dataRanges = updates.map(([header, value]) => {
    const index = headerIndex(headers, header);

    if (index < 0 || index >= 20) {
      throw new Error(
        'Invalid Accounts sheet column: ' + header
      );
    }

    const column = String.fromCharCode(65 + index);

    return {
      range: `Accounts!${column}${rowNumber}`,
      values: [[String(value ?? '')]]
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: dataRanges
    }
  });

  return true;
}

async function recordAuditEvent({
  eventId,
  action,
  accountId,
  actorId,
  actorUsername,
  actorRole,
  outcome
}) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'AccountChangeAudit!A:H',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        eventId || crypto.randomUUID(),
        new Date().toISOString(),
        String(action || ''),
        String(accountId || ''),
        String(actorId || ''),
        String(actorUsername || ''),
        String(actorRole || ''),
        String(outcome || '')
      ]]
    }
  });
}

const TRASH_HEADERS = [
  ...HEADERS,
  'Deleted At',
  'Deleted By'
];

async function readSheet(tab, lastColumn) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A1:${lastColumn}`
  });

  return response.data.values || [];
}

async function getSheetId(tab) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });

  const sheet = (response.data.sheets || []).find(
    s => s.properties.title === tab
  );

  if (!sheet) {
    throw new Error('Missing Google Sheet tab: ' + tab);
  }

  return sheet.properties.sheetId;
}

function findUniqueRecord(rows, id, tab) {
  if (!rows.length) {
    throw new Error(tab + ' has no headings');
  }

  const idIndex = headerIndex(rows[0], 'ID');

  if (idIndex < 0) {
    throw new Error(tab + ' is missing ID heading');
  }

  const matches = [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIndex] || '') === id) {
      matches.push({
        rowIndex: i,
        values: rows[i]
      });
    }
  }

  if (matches.length > 1) {
    throw new Error('Duplicate ID found in ' + tab);
  }

  return matches[0] || null;
}

async function appendRecord(tab, headers, record) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tab}'!A:${tab === 'Trash' ? 'V' : 'T'}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        headers.map(name => String(record[name] ?? ''))
      ]
    }
  });
}

async function removeRow(tab, rowIndex) {
  const sheetId = await getSheetId(tab);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex,
            endIndex: rowIndex + 1
          }
        }
      }]
    }
  });
}

async function getTrashAccounts() {
  const rows = await readSheet('Trash', 'V');

  if (!rows.length) return [];

  const headers = rows[0];

  const missing = TRASH_HEADERS.filter(
    name => headerIndex(headers, name) < 0
  );

  if (missing.length) {
    throw new Error(
      'Trash headings missing: ' + missing.join(', ')
    );
  }

  return rows.slice(1)
    .filter(row => {
      const index = headerIndex(headers, 'ID');
      return String(row[index] || '').trim();
    })
    .map(row => {
      const record = {};

      TRASH_HEADERS.forEach(name => {
        const index = headerIndex(headers, name);
        record[name] = String(row[index] || '');
      });

      return record;
    });
}

// Move an account from Accounts to Trash.
async function deleteAccount(id, deletedBy) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Invalid account ID');
  }

  const sourceRows = await readSheet('Accounts', 'T');
  const trashRows = await readSheet('Trash', 'V');

  if (!trashRows.length) {
    throw new Error('Trash headings are missing');
  }

  const source = findUniqueRecord(
    sourceRows, id, 'Accounts'
  );

  if (!source) return false;

  const existingTrash = findUniqueRecord(
    trashRows, id, 'Trash'
  );

  if (existingTrash) {
    throw new Error(
      'Account already exists in Trash. Review before retrying.'
    );
  }

  const record = {};

  HEADERS.forEach(name => {
    const index = headerIndex(sourceRows[0], name);
    record[name] = index >= 0
      ? String(source.values[index] || '')
      : '';
  });

  record['Deleted At'] = new Date().toISOString();
  record['Deleted By'] = String(deletedBy || '');

  await appendRecord('Trash', TRASH_HEADERS, record);

  // Verify the backup before removing the original.
  const verifiedTrashRows = await readSheet('Trash', 'V');
  const verified = findUniqueRecord(
    verifiedTrashRows, id, 'Trash'
  );

  if (!verified) {
    throw new Error(
      'Trash copy could not be verified. Original retained.'
    );
  }

  const currentSourceRows = await readSheet(
    'Accounts', 'T'
  );

  const currentSource = findUniqueRecord(
    currentSourceRows, id, 'Accounts'
  );

  if (!currentSource) {
    throw new Error(
      'Original account changed during deletion. Review sheets.'
    );
  }

  await removeRow('Accounts', currentSource.rowIndex);

  return true;
}

// Restore an account from Trash to Accounts.
async function restoreAccount(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Invalid account ID');
  }

  const trashRows = await readSheet('Trash', 'V');
  const sourceRows = await readSheet('Accounts', 'T');

  const trashRecord = findUniqueRecord(
    trashRows, id, 'Trash'
  );

  if (!trashRecord) return false;

  if (findUniqueRecord(sourceRows, id, 'Accounts')) {
    throw new Error(
      'Account already exists in Accounts. Review before restoring.'
    );
  }

  const record = {};

  HEADERS.forEach(name => {
    const index = headerIndex(trashRows[0], name);
    record[name] = index >= 0
      ? String(trashRecord.values[index] || '')
      : '';
  });

  await appendRecord('Accounts', HEADERS, record);

  // Verify the restored copy before removing Trash entry.
  const verifiedRows = await readSheet('Accounts', 'T');
  const verified = findUniqueRecord(
    verifiedRows, id, 'Accounts'
  );

  if (!verified) {
    throw new Error(
      'Restored account could not be verified. Trash retained.'
    );
  }

  const currentTrashRows = await readSheet(
    'Trash', 'V'
  );

  const currentTrash = findUniqueRecord(
    currentTrashRows, id, 'Trash'
  );

  if (!currentTrash) {
    throw new Error(
      'Trash record changed during restore. Review sheets.'
    );
  }

  await removeRow('Trash', currentTrash.rowIndex);

  return true;
}

async function getActivityHistory() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'AccountChangeAudit!A2:H',
    valueRenderOption: 'FORMATTED_VALUE'
  });

  const rows = response.data.values || [];

  return rows
    .filter(row => row.some(value => String(value || '').trim()))
    .map(row => ({
      eventId: String(row[0] || ''),
      timestamp: String(row[1] || ''),
      action: String(row[2] || ''),
      accountId: String(row[3] || ''),
      actorId: String(row[4] || ''),
      username: String(row[5] || ''),
      role: String(row[6] || ''),
      outcome: String(row[7] || '')
    }))
    .reverse();
}
module.exports = {
  getAccounts,
  addAccount,
  updateAccount,
  recordAuditEvent,
  getTrashAccounts,
  deleteAccount,
  restoreAccount,
  getActivityHistory
};