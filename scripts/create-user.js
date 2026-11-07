require('dotenv').config();
const argon2=require('argon2');const readline=require('node:readline/promises');const pool=require('../db');
const role=process.argv[2];
async function main(){const rl=readline.createInterface({input:process.stdin,output:process.stdout});try{
 if(!['MASTER','MANAGER'].includes(role))throw new Error('Specify MASTER or MANAGER');
 const username=(await rl.question(`${role} username: `)).trim();if(!/^[A-Za-z0-9_]{3,50}$/.test(username))throw new Error('Invalid username');
 const password=await rl.question('New password (15+ characters; visible while typing): ');if(password.length<15||Buffer.byteLength(password)>1024)throw new Error('Password must be at least 15 characters and at most 1024 bytes');
 const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
 const c=await pool.connect();try{await c.query('BEGIN');const u=await c.query('INSERT INTO public.app_users(username,password_hash,role,is_active) VALUES($1,$2,$3,true) RETURNING id,username,role',[username,hash,role]);if(role==='MANAGER')await c.query('INSERT INTO public.user_permissions(user_id,can_add) VALUES($1,true)',[u.rows[0].id]);await c.query('INSERT INTO public.auth_audit(user_id,action) VALUES($1,$2)',[u.rows[0].id,'ACCOUNT_CREATED']);await c.query('COMMIT');console.log('Created:',u.rows[0].username,u.rows[0].role);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}catch(e){console.error('Failed:',e.message);process.exitCode=1;}finally{rl.close();await pool.end();}}
main();
