require('dotenv').config();
const argon2=require('argon2');const readline=require('node:readline/promises');const pool=require('../db');
async function main(){const rl=readline.createInterface({input:process.stdin,output:process.stdout});try{
 const username=(await rl.question('Existing Master username (e.g. king): ')).trim();
 const u=await pool.query("SELECT id FROM public.app_users WHERE username=$1 AND role='MASTER' AND is_active=true",[username]);if(u.rowCount!==1)throw new Error('Active Master account not found');
 const password=await rl.question('New password (15+ characters; visible while typing): ');if(password.length<15||Buffer.byteLength(password)>1024)throw new Error('Password length invalid');
 const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});const c=await pool.connect();try{await c.query('BEGIN');await c.query('UPDATE public.app_users SET password_hash=$1 WHERE id=$2',[hash,u.rows[0].id]);await c.query("DELETE FROM public.user_sessions WHERE sess->'user'->>'id'=$1",[String(u.rows[0].id)]);await c.query('INSERT INTO public.auth_audit(user_id,action) VALUES($1,$2)',[u.rows[0].id,'MASTER_PASSWORD_RESET']);await c.query('COMMIT');console.log('Password reset successful');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}catch(e){console.error('Failed:',e.message);process.exitCode=1;}finally{rl.close();await pool.end();}}main();
