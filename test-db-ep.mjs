import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const PASSWORD = process.env.ATLAS_LOCAL_PG_PASSWORD ?? 'pw'

const log = (m) => {
  console.log(m)
  fs.appendFileSync('test-db-ep-out.txt', m + '\n')
}

async function run() {
  const dataDir = path.resolve('.pgdata-ep')
  
  // Clean up
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch {}
  
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: PASSWORD,
    port: 5437,
    persistent: false,
  })

  let client

  try {
    log('initialising embedded postgres...')
    await pg.initialise()
    log('initialised')
    
    log('starting...')
    await pg.start()
    log('started')
    
    log('creating database...')
    await pg.createDatabase('atlas')
    log('database created')
    
    // Connect with pg client
    client = new Client({
      host: 'localhost',
      port: 5437,
      user: 'postgres',
      password: PASSWORD,
      database: 'atlas',
      connectionTimeoutMillis: 10000,
    })
    await client.connect()
    log('connected to postgres')
    
    const r = await client.query('select version() as v')
    log('REAL POSTGRES: ' + r.rows[0].v)
    
    // Create Supabase auth schema and minimal tables needed by migrations
    log('Creating auth schema and roles...')
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text,
        encrypted_password text,
        email_confirmed_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULL::uuid;
      $$;
      -- Create Supabase roles
      DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE ROLE authenticated NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE ROLE service_role NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT anon TO postgres;
      GRANT authenticated TO postgres;
      GRANT service_role TO postgres;
    `)
    log('Auth schema and roles created')
    
    // Apply migrations in order
    const migrations = [
      'supabase/migrations/0001_init.sql',
      'supabase/migrations/0002_production_hardening.sql',
      'supabase/migrations/0003_security_fixes.sql',
    ]
    
    for (const migration of migrations) {
      log('Applying ' + migration + '...')
      const sql = fs.readFileSync(migration, 'utf8')
      await client.query(sql)
      log('Applied ' + migration)
    }
    
    log('All migrations applied successfully')
    
    // Test basic query
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name
    `)
    log('Tables: ' + tables.rows.map(r => r.table_name).join(', '))
    
    log('SUCCESS: Database is ready for integration tests')
    
  } catch (e) {
    log('FAILED: ' + e.message + '\n' + e.stack)
    process.exit(1)
  } finally {
    try { 
      if (client) await client.end()
      await pg.stop(); 
      log('stopped') 
    } catch (e) { log('stop failed: ' + e.message) }
  }
}

run()