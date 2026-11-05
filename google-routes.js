
const express = require('express');
const crypto = require('node:crypto');
const pool = require('./db');
const {
  authenticated,
  csrf,
  requirePermission
} = require('./security');

const {
  getAccounts,
  addAccount,
  updateAccount,
  recordAuditEvent,
  getTrashAccounts,
  deleteAccount,
  restoreAccount,
  getActivityHistory
} = require('./google-sheets');

const router = express.Router();

const validAccountId = id =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function safeAccount(account) {
  return {
    id: account['ID'] || '',
    accountHolder: account['Account Holder'] || '',
    bankName: account['Bank Name'] || '',
    accountLast4: account['Account Last 4 Digits'] || '',
    ifscCode: account['IFSC Code'] || '',
    branch: account['Branch'] || '',
    accountType: account['Account Type'] || '',
    status: account['Account Status'] || ''
  };
}

function validateAccount(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new Error('Invalid account data');
  }

  const allowed = [
    'accountHolder',
    'bankName',
    'accountLast4',
    'ifscCode',
    'branch',
    'accountType',
    'status'
  ];

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new Error('Unexpected field: ' + key);
    }
  }

  function field(name, maxLength) {
    const raw = body[name];

    if (raw === undefined || raw === null) {
      return '';
    }

    if (typeof raw !== 'string') {
      throw new Error('Invalid ' + name);
    }

    const value = raw.trim();

    if (
      value.length > maxLength ||
      /[\u0000-\u001F\u007F]/.test(value)
    ) {
      throw new Error('Invalid ' + name);
    }

    return value;
  }

  const data = {
    accountHolder: field('accountHolder', 100),
    bankName: field('bankName', 100),
    accountLast4: field('accountLast4', 4),
    ifscCode: field('ifscCode', 20),
    branch: field('branch', 100),
    accountType: field('accountType', 20),
    status: field('status', 20)
  };

  if (!data.accountHolder || !data.bankName) {
    throw new Error(
      'Account holder and bank name are required'
    );
  }

  if (!/^\d{4}$/.test(data.accountLast4)) {
    throw new Error(
      'Enter exactly four account digits'
    );
  }

  if (
    !['Savings', 'Current', 'Other']
      .includes(data.accountType)
  ) {
    throw new Error('Invalid account type');
  }

  if (
    ![
      '',
      'Active',
      'Inactive',
      'Dormant',
      'Closed',
      'Frozen',
      'Pending'
    ].includes(data.status)
  ) {
    throw new Error('Invalid account status');
  }

  return data;
}

// VIEW ACCOUNTS
router.get(
  '/accounts',
  authenticated(),
  requirePermission('can_view'),
  async (req, res, next) => {
    try {
      const accounts = await getAccounts();

      res.set('Cache-Control', 'no-store');

      return res.json({
        accounts: accounts.map(safeAccount),
        role: req.session.user.role
      });
    } catch (error) {
      next(error);
    }
  }
);

// ADD ACCOUNT
router.post(
  '/accounts',
  authenticated(),
  requirePermission('can_add'),
  csrf,
  async (req, res, next) => {
    try {
      const user = req.session.user;

      let data;

      try {
        data = validateAccount(req.body);
      } catch (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      const eventId = crypto.randomUUID();
      const accountId = crypto.randomUUID();

      await recordAuditEvent({
        eventId,
        action: 'CREATE_REQUESTED',
        accountId,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        outcome: 'REQUESTED'
      });

      let savedId;

      try {
        savedId = await addAccount({
          ...data,
          id: accountId
        });
      } catch (error) {
        console.error(
          'Account creation outcome uncertain:',
          eventId,
          error
        );

        return res.status(503).json({
          error:
            'Save outcome uncertain. Check Accounts and AccountChangeAudit before retrying.',
          eventId
        });
      }

      try {
        await recordAuditEvent({
          eventId,
          action: 'ACCOUNT_CREATED',
          accountId: savedId,
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          outcome: 'SUCCESS'
        });
      } catch (error) {
        console.error(
          'Audit completion failed:',
          eventId,
          error
        );

        return res.status(202).json({
          success: true,
          id: savedId,
          warning:
            'Account saved, but audit completion requires review.'
        });
      }

      res.set('Cache-Control', 'no-store');

      return res.status(201).json({
        success: true,
        id: savedId
      });
    } catch (error) {
      next(error);
    }
  }
);

// EDIT ACCOUNT - MASTER OR AUTHORIZED MANAGER
router.put(
  '/accounts/:id',
  authenticated(),
  requirePermission('can_edit'),
  csrf,
  async (req, res, next) => {
    try {
      const user = req.session.user;
      const accountId = req.params.id;

      if (!validAccountId(accountId)) {
        return res.status(400).json({
          error: 'Invalid account ID'
        });
      }

      let data;

      try {
        data = validateAccount(req.body);
      } catch (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      const accounts = await getAccounts();

      const existing = accounts.find(
        account => account['ID'] === accountId
      );

      if (!existing) {
        return res.status(404).json({
          error: 'Account not found'
        });
      }

      const eventId = crypto.randomUUID();

      await recordAuditEvent({
        eventId,
        action: 'UPDATE_REQUESTED',
        accountId,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        outcome: 'REQUESTED'
      });

      try {
        const updated = await updateAccount(
          accountId,
          data
        );

        if (!updated) {
          return res.status(404).json({
            error: 'Account not found during update',
            eventId
          });
        }
      } catch (error) {
        console.error(
          'Account update outcome uncertain:',
          eventId,
          error
        );

        return res.status(503).json({
          error:
            'Update outcome uncertain. Check the Accounts sheet before retrying.',
          eventId
        });
      }

      try {
        await recordAuditEvent({
          eventId,
          action: 'ACCOUNT_UPDATED',
          accountId,
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          outcome: 'SUCCESS'
        });
      } catch (error) {
        console.error(
          'Update audit completion failed:',
          eventId,
          error
        );

        return res.status(202).json({
          success: true,
          id: accountId,
          warning:
            'Account updated, but audit completion requires review.'
        });
      }

      res.set('Cache-Control', 'no-store');

      return res.json({
        success: true,
        id: accountId
      });
    } catch (error) {
      next(error);
    }
  }
);

// VIEW RECYCLE BIN - MASTER OR AUTHORIZED MANAGER
router.get(
  '/trash',
  authenticated(),
  requirePermission('can_restore'),
  async (req, res, next) => {
    try {
      const records = await getTrashAccounts();

      res.set('Cache-Control', 'no-store');

      return res.json({
        accounts: records.map(account => ({
          ...safeAccount(account),
          deletedAt: account['Deleted At'] || '',
          deletedBy: account['Deleted By'] || ''
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE ACCOUNT - MASTER OR AUTHORIZED MANAGER
router.delete(
  '/accounts/:id',
  authenticated(),
  requirePermission('can_delete'),
  csrf,
  async (req, res, next) => {
    try {
      const user = req.session.user;
      const id = req.params.id;

      if (!validAccountId(id)) {
        return res.status(400).json({
          error: 'Invalid account ID'
        });
      }

      const eventId = crypto.randomUUID();

      await recordAuditEvent({
        eventId,
        action: 'DELETE_REQUESTED',
        accountId: id,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        outcome: 'REQUESTED'
      });

      let deleted;

      try {
        deleted = await deleteAccount(
          id,
          user.username
        );
      } catch (error) {
        console.error(
          'Delete outcome uncertain:',
          eventId,
          error
        );

        return res.status(503).json({
          error:
            'Delete outcome uncertain. Check Accounts and Trash before retrying.',
          eventId
        });
      }

      if (!deleted) {
        return res.status(404).json({
          error: 'Account not found'
        });
      }

      try {
        await recordAuditEvent({
          eventId,
          action: 'ACCOUNT_DELETED',
          accountId: id,
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          outcome: 'SUCCESS'
        });
      } catch (error) {
        console.error(
          'Delete audit failed:',
          eventId,
          error
        );

        return res.status(202).json({
          success: true,
          warning:
            'Account moved to Trash, but audit completion requires review.'
        });
      }

      res.set('Cache-Control', 'no-store');

      return res.json({
        success: true,
        message: 'Account moved to Recycle Bin'
      });
    } catch (error) {
      next(error);
    }
  }
);

// RESTORE ACCOUNT - MASTER OR AUTHORIZED MANAGER
router.post(
  '/trash/:id/restore',
  authenticated(),
  requirePermission('can_restore'),
  csrf,
  async (req, res, next) => {
    try {
      const user = req.session.user;
      const id = req.params.id;

      if (!validAccountId(id)) {
        return res.status(400).json({
          error: 'Invalid account ID'
        });
      }

      const eventId = crypto.randomUUID();

      await recordAuditEvent({
        eventId,
        action: 'RESTORE_REQUESTED',
        accountId: id,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        outcome: 'REQUESTED'
      });

      let restored;

      try {
        restored = await restoreAccount(id);
      } catch (error) {
        console.error(
          'Restore outcome uncertain:',
          eventId,
          error
        );

        return res.status(503).json({
          error:
            'Restore outcome uncertain. Check Accounts and Trash before retrying.',
          eventId
        });
      }

      if (!restored) {
        return res.status(404).json({
          error: 'Account not found in Trash'
        });
      }

      try {
        await recordAuditEvent({
          eventId,
          action: 'ACCOUNT_RESTORED',
          accountId: id,
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          outcome: 'SUCCESS'
        });
      } catch (error) {
        console.error(
          'Restore audit failed:',
          eventId,
          error
        );

        return res.status(202).json({
          success: true,
          warning:
            'Account restored, but audit completion requires review.'
        });
      }

      res.set('Cache-Control', 'no-store');

      return res.json({
        success: true,
        message: 'Account restored successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/my-permissions',
  authenticated(),
  async (req, res, next) => {
    try {
      const user = req.session.user;

      const keys = [
        'can_view',
        'can_add',
        'can_edit',
        'can_delete',
        'can_restore'
      ];

      if (user.role === 'MASTER') {
        res.set('Cache-Control', 'no-store');

        return res.json({
          role: 'MASTER',
          permissions: Object.fromEntries(
            keys.map(key => [key, true])
          )
        });
      }

      if (user.role !== 'MANAGER') {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      const result = await pool.query(
        `SELECT
        COALESCE(p.can_view, false) AS can_view,
COALESCE(p.can_add, false) AS can_add,
COALESCE(p.can_edit, false) AS can_edit,
COALESCE(p.can_delete, false) AS can_delete,
COALESCE(p.can_restore, false) AS can_restore
         FROM public.app_users u
         LEFT JOIN public.user_permissions p
           ON p.user_id = u.id
         WHERE u.id = $1
           AND u.role = 'MANAGER'
           AND u.is_active = true`,
        [user.id]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      res.set('Cache-Control', 'no-store');

      return res.json({
        role: 'MANAGER',
      permissions: {
  can_view: result.rows[0].can_view,
  can_add: result.rows[0].can_add,
  can_edit: result.rows[0].can_edit,
  can_delete: result.rows[0].can_delete,
  can_restore: result.rows[0].can_restore
}
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/activity-history',
  authenticated(),
  requirePermission('can_view_audit'),
  async (req, res, next) => {
    try {
      const events = await getActivityHistory();

      res.set('Cache-Control', 'no-store');

      return res.json({
        events
      });
    } catch (error) {
      next(error);
    }
  }
);
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

module.exports = router;
