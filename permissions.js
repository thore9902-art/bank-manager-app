
const express = require('express');
const argon2 = require('argon2');
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const { authenticated, csrf } = require('./security');

const router = express.Router();

const keys = [
  'can_view',
  'can_add',
  'can_edit',
  'can_delete',
  'can_restore',
  'can_export',
  'can_view_audit',
  'can_manage_users'
];

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Try again later.'
  }
});

router.use(authenticated('MASTER'));

function validId(id) {
  return /^[1-9]\d*$/.test(String(id));
}

function validUsername(username) {
  return (
    typeof username === 'string' &&
    /^[A-Za-z0-9_.-]{3,50}$/.test(username)
  );
}

function validPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    password.length <= 128 &&
    Buffer.byteLength(password, 'utf8') <= 1024
  );
}

function validBody(body, fields) {
  return (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === fields.length &&
    fields.every(field =>
      Object.prototype.hasOwnProperty.call(body, field)
    )
  );
}

async function revokeManagerSessions(client, managerId) {
  await client.query(
    `DELETE FROM public.user_sessions
     WHERE sess::jsonb #>> '{user,id}' = $1`,
    [String(managerId)]
  );
}

async function audit(client, userId, action) {
  await client.query(
    `INSERT INTO public.auth_audit
     (user_id, action)
     VALUES ($1, $2)`,
    [userId, action]
  );
}

async function getManagerForUpdate(client, id) {
  const result = await client.query(
    `SELECT id, username, is_active
     FROM public.app_users
     WHERE id = $1 AND role = 'MANAGER'
     FOR UPDATE`,
    [id]
  );

  return result.rows[0] || null;
}

// Existing CSRF endpoint
router.get('/csrf-token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    csrfToken: req.session.csrfToken
  });
});

// View all managers and their permissions
router.get('/managers', async (req, res, next) => {
  try {
    const cols = keys
      .map(key =>
        `COALESCE(p.${key}, false) AS ${key}`
      )
      .join(', ');

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.role,
         u.is_active,
         u.created_at,
         ${cols}
       FROM public.app_users u
       LEFT JOIN public.user_permissions p
         ON p.user_id = u.id
       WHERE u.role = 'MANAGER'
       ORDER BY u.id`
    );

    res.set('Cache-Control', 'no-store');

    res.json({
      managers: result.rows
    });
  } catch (error) {
    next(error);
  }
});

// Create a new Manager
router.post(
  '/managers',
  adminLimiter,
  csrf,
  async (req, res, next) => {
    try {
      const body = req.body;

      if (!validBody(body, ['username', 'password'])) {
        return res.status(400).json({
          error: 'Username and password are required'
        });
      }

      const username = body.username.trim();
      const password = body.password;

      if (!validUsername(username)) {
        return res.status(400).json({
          error:
            'Username must be 3-50 characters and use letters, numbers, _, . or -'
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error: 'Password must be 12-128 characters'
        });
      }

      const passwordHash = await argon2.hash(
        password,
        { type: argon2.argon2id }
      );

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `INSERT INTO public.app_users
             (username, password_hash, role, is_active)
           VALUES ($1, $2, 'MANAGER', true)
           RETURNING id, username, role, is_active, created_at`,
          [username, passwordHash]
        );

        const manager = result.rows[0];

        await audit(
          client,
          req.session.user.id,
          `MANAGER_CREATED id=${manager.id}`
        );

        await client.query('COMMIT');

        return res.status(201).json({
          message: 'Manager created successfully',
          manager
        });

      } catch (error) {
        await client.query('ROLLBACK');

        if (error.code === '23505') {
          return res.status(409).json({
            error: 'Username already exists'
          });
        }

        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      next(error);
    }
  }
);

// Enable or disable a Manager
router.patch(
  '/managers/:id/status',
  adminLimiter,
  csrf,
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const body = req.body;

      if (!validId(id)) {
        return res.status(400).json({
          error: 'Invalid Manager ID'
        });
      }

      if (
        !validBody(body, ['is_active']) ||
        typeof body.is_active !== 'boolean'
      ) {
        return res.status(400).json({
          error: 'is_active must be true or false'
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const manager = await getManagerForUpdate(
          client,
          id
        );

        if (!manager) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            error: 'Manager not found'
          });
        }

        await client.query(
          `UPDATE public.app_users
           SET is_active = $1
           WHERE id = $2 AND role = 'MANAGER'`,
          [body.is_active, id]
        );

if (!body.is_active) {
  await revokeManagerSessions(client, id);
}

        await audit(
          client,
          req.session.user.id,
          `${body.is_active ? 'MANAGER_ENABLED' : 'MANAGER_DISABLED'} id=${id}`
        );

        await client.query('COMMIT');

        res.json({
          message: body.is_active
            ? 'Manager enabled successfully'
            : 'Manager disabled successfully'
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      next(error);
    }
  }
);

// Reset a Manager password
router.post(
  '/managers/:id/reset-password',
  adminLimiter,
  csrf,
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const body = req.body;

      if (!validId(id)) {
        return res.status(400).json({
          error: 'Invalid Manager ID'
        });
      }

      if (
        !validBody(body, ['newPassword']) ||
        !validPassword(body.newPassword)
      ) {
        return res.status(400).json({
          error: 'New password must be 12-128 characters'
        });
      }

      const passwordHash = await argon2.hash(
        body.newPassword,
        { type: argon2.argon2id }
      );

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const manager = await getManagerForUpdate(
          client,
          id
        );

        if (!manager) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            error: 'Manager not found'
          });
        }

        await client.query(
          `UPDATE public.app_users
           SET password_hash = $1
           WHERE id = $2 AND role = 'MANAGER'`,
          [passwordHash, id]
        );

await revokeManagerSessions(client, id);

        await audit(
          client,
          req.session.user.id,
          `MANAGER_PASSWORD_RESET id=${id}`
        );

        await client.query('COMMIT');

        res.json({
          message: 'Manager password reset successfully'
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      next(error);
    }
  }
);

// Existing eight-permission management
router.put(
  '/managers/:id/permissions',
  csrf,
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const body = req.body;

      if (!validId(id)) {
        return res.status(400).json({
          error: 'Invalid ID'
        });
      }

      if (
        !validBody(body, keys) ||
        keys.some(key => typeof body[key] !== 'boolean')
      ) {
        return res.status(400).json({
          error: 'All eight permissions must be boolean'
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const manager = await getManagerForUpdate(
          client,
          id
        );

        if (!manager) {
          await client.query('ROLLBACK');

          return res.status(404).json({
            error: 'Manager not found'
          });
        }

        const values = keys.map(key => body[key]);
        const names = keys.join(',');
        const assignments = keys
          .map(key => `${key}=EXCLUDED.${key}`)
          .join(',');

        await client.query(
          `INSERT INTO public.user_permissions
             (user_id, ${names})
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(user_id)
           DO UPDATE SET ${assignments}`,
          [id, ...values]
        );

        await audit(
          client,
          req.session.user.id,
          `PERMISSIONS_UPDATED manager_id=${id}`
        );

        await client.query('COMMIT');

        res.json({
          message: 'Permissions saved'
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
