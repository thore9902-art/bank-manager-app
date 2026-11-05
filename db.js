require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,max:10});
module.exports=pool;
