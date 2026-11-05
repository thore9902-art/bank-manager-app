
const crypto = require('node:crypto');
const pool = require('./db');

function authenticated(role) {
  return async (req, res, next) => {
    try {
      const user = req.session?.user;

      if (!user) {
        return res.status(401).json({
          error: 'Login required'
        });
      }

      const result = await pool.query(
        `SELECT id, username, role, is_active
         FROM public.app_users
         WHERE id = $1`,
        [user.id]
      );

      const current = result.rows[0];

      if (
        !current?.is_active ||
        current.role !== user.role
      ) {
        return res.status(401).json({
          error: 'Session no longer valid'
        });
      }

      if (role && current.role !== role) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.session?.csrfToken;
  const supplied = req.get('X-CSRF-Token');

  if (
    typeof token !== 'string' ||
    typeof supplied !== 'string'
  ) {
    return res.status(403).json({
      error: 'Invalid CSRF token'
    });
  }

  const a = Buffer.from(token);
  const b = Buffer.from(supplied);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(403).json({
      error: 'Invalid CSRF token'
    });
  }

  next();
}

const allowedPermissions = new Set([
  'can_view',
  'can_add',
  'can_edit',
  'can_delete',
  'can_restore',
  'can_export',
  'can_view_audit',
  'can_manage_users'
]);

function requirePermission(permission) {
  if (!allowedPermissions.has(permission)) {
    throw new Error('Unknown permission: ' + permission);
  }

  return async (req, res, next) => {
    try {
      const user = req.session?.user;

      if (!user) {
        return res.status(401).json({
          error: 'Login required'
        });
      }

      if (user.role === 'MASTER') {
        return next();
      }

      if (user.role !== 'MANAGER') {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      const result = await pool.query(
        `SELECT
           COALESCE(p.${permission}, false) AS allowed
         FROM public.app_users u
         LEFT JOIN public.user_permissions p
           ON p.user_id = u.id
         WHERE u.id = $1
           AND u.role = 'MANAGER'
           AND u.is_active = true`,
        [user.id]
      );

      if (!result.rows[0]?.allowed) {
        return res.status(403).json({
          error: 'Permission denied'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  authenticated,
  csrf,
  requirePermission
};
