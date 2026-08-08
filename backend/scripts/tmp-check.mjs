import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\//, '') });

const c = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [users] = await c.query(
  "SELECT id, username, role, status FROM users WHERE id='3ec371e2-7f61-4ec1-a560-9102931f8ce8' OR username IN ('admin','manash','ashishpiya')",
);
console.log('USERS:', users);

const [caps] = await c.query(
  "SELECT role, GROUP_CONCAT(capability ORDER BY capability) AS caps FROM role_capabilities GROUP BY role",
);
for (const r of caps) console.log(r.role, '=>', r.caps);

await c.end();
