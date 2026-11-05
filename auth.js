const express=require('express');
const argon2=require('argon2');
const rateLimit=require('express-rate-limit');
const pool=require('./db');
const router=express.Router();
const limiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again later.'}});
const record=async(userId,action)=>{try{await pool.query('INSERT INTO public.auth_audit(user_id,action) VALUES ($1,$2)',[userId,action]);}catch(e){console.error('Audit failure:',e.message);}};
router.post('/login',limiter,async(req,res,next)=>{
 try{
  const {username,password,loginRole}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string'||typeof loginRole!=='string'||!['MASTER','MANAGER'].includes(loginRole)||username.length>50||password.length>1024)return res.status(400).json({error:'Invalid request'});
  const found=await pool.query('SELECT id,username,password_hash,role,is_active FROM public.app_users WHERE username=$1',[username.trim()]);
  const u=found.rows[0];
  if(!u||!u.is_active||u.role!==loginRole||!(await argon2.verify(u.password_hash,password))){await record(u?.id||null,'LOGIN_FAILED');return res.status(401).json({error:'Invalid username or password'});}
  req.session.regenerate(async(err)=>{
   if(err)return next(err);
   req.session.user={id:String(u.id),username:u.username,role:u.role};
   req.session.csrfToken=require('node:crypto').randomBytes(32).toString('hex');
   req.session.save(async(err2)=>{if(err2)return next(err2);await record(u.id,'LOGIN_SUCCESS');res.json({user:req.session.user});});
  });
 }catch(e){next(e);}
});
router.get('/me',(req,res)=>res.json({user:req.session?.user||null}));
router.get('/csrf-token',(req,res)=>{if(!req.session?.user)return res.status(401).json({error:'Login required'});res.set('Cache-Control','no-store');res.json({csrfToken:req.session.csrfToken});});
router.post('/logout',require('./security').csrf,(req,res,next)=>{if(!req.session)return res.json({ok:true});req.session.destroy(err=>{if(err)return next(err);res.clearCookie('bank.sid');res.json({ok:true});});});
module.exports=router;
