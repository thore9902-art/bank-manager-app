require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const session=require('express-session');
const PgStore=require('connect-pg-simple')(session);
const rateLimit=require('express-rate-limit');
const path=require('node:path');
const pool=require('./db');
const auth=require('./auth');
const permissions=require('./permissions');
const {authenticated}=require('./security');
if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw new Error('Set SESSION_SECRET (32+ characters) in .env');
const app=express();app.disable('x-powered-by');app.use(helmet());app.use(express.json({limit:'10kb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}));
app.use(session({name:'bank.sid',store:new PgStore({pool,tableName:'user_sessions',createTableIfMissing:false}),secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:false,sameSite:'strict',maxAge:30*60*1000}}));
app.use('/api/auth',auth);
const googleRoutes = require('./google-routes');
app.use('/api/google', googleRoutes);
app.use('/api/master',permissions);
function page(route,file,role){app.get(route,authenticated(role),(req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.join(__dirname,'public',file));});}
app.get('/master/login',(req,res)=>res.sendFile(path.join(__dirname,'public','master-login.html')));
app.get('/manager/login',(req,res)=>res.sendFile(path.join(__dirname,'public','manager-login.html')));
page('/master/dashboard','master-dashboard.html','MASTER');

app.get(
  '/bank/assets/accounts-view.js',
  authenticated(),
  (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript');

    res.sendFile(
      path.join(
        __dirname,
        'google-dashboard',
        'accounts-view.js'
      )
    );
  }
);

// Protected Google-style dashboard for Master and Manager
app.get('/bank/dashboard', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/master/login');
  }

  if (!['MASTER', 'MANAGER'].includes(req.session.user.role)) {
    return res.status(403).send('Access denied');
  }

  res.set('Cache-Control', 'no-store');

  return res.sendFile(
    path.join(__dirname, 'google-dashboard', 'index.html')
  );
});
page('/manager/dashboard','manager-dashboard.html','MANAGER');
page('/master/permissions','master-permissions.html','MASTER');

page('/master/users','master-users.html','MASTER');page('/master/users', 'master-users.html', 'MASTER');
page('/master/activity-history', 'activity-history.html', 'MASTER');
for(const name of ['login.js','dashboard.js','master-permissions.js','master-users.js','style.css'])app.get('/assets/'+name,(req,res)=>res.sendFile(path.join(__dirname,'public',name)));
app.get('/api/status',(req,res)=>res.json({status:'OK'}));
app.get('/',(req,res)=>res.redirect('/master/login'));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal server error'});});
const port=Number(process.env.PORT||3000);
app.listen(port,'127.0.0.1',()=>console.log(`Bank Manager running at http://127.0.0.1:${port}`));
