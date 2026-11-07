
const pool = require('./db');

const validAccountId = id =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function canAccessAccount(user, accountId) {
  if (!user || !validAccountId(accountId)) {
    return false;
  }

  const result = await pool.query(
    `SELECT
       u.role,
       u.is_active,
       COALESCE(p.can_view, false) AS can_view,
       EXISTS (
         SELECT 1
         FROM public.account_user_access a
         WHERE a.user_id = u.id
           AND a.account_id = $2
       ) AS assigned
     FROM public.app_users u
     LEFT JOIN public.user_permissions p
       ON p.user_id = u.id
     WHERE u.id = $1`,
    [user.id, accountId]
  );

  const record = result.rows[0];

  if (!record?.is_active) {
    return false;
  }

  if (record.role === 'MASTER') {
    return true;
  }

  if (record.role === 'MANAGER') {
    return record.can_view && record.assigned;
  }

  return false;
}

module.exports = {
  canAccessAccount
};
