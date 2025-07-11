import { Pool } from 'pg';

export const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'timelineverse',
  password: process.env.PGPASSWORD || 'postgres',
  port: +(process.env.PGPORT || 5432),
});
