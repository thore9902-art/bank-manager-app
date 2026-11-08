
require('dotenv').config();

const { validatePassword } = require('../password-policy');
const argon2 = require('argon2');
const readline = require('node:readline/promises');
const pool = require('../db');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const username = (
      await rl.question('Existing Master username: ')
    ).trim();

    const u = await pool.query(
      `SELECT id
       FROM public.app_users
       WHERE username = $1
         AND role = 'MASTER'
         AND is_active = true`,
      [username]
    );

    if (u.rowCount !== 1) {
      throw new Error('Active Master account not found');
    }

    const password = await rl.question(
      'New password (minimum 6 characters; visible while typing): '
    );

    validatePassword(password);

    if (Buffer.byteLength(password, 'utf8') > 1024) {
      throw new Error('Password must be at most 1024 bytes');
    }

    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });

    const c = await pool.connect();

    try {
      await c.query('BEGIN');

      await c.query(
        'UPDATE public.app_users SET password_hash = $1 WHERE id = $2',
        [hash, u.rows[0].id]
      );

      await c.query(
        `DELETE FROM public.user_sessions
         WHERE sess->'user'->>'id' = $1`,
        [String(u.rows[0].id)]
      );

      await c.query(
        `INSERT INTO public.auth_audit(user_id, action)
         VALUES ($1, $2)`,
        [u.rows[0].id, 'MASTER_PASSWORD_RESET']
      );

      await c.query('COMMIT');

      console.log('Password reset successful');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  } catch (error) {
    console.error('Failed:', error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
