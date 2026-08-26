import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import fs from 'node:fs'

const log = (m) => fs.appendFileSync('test-db-out.txt', m + '\n')
fs.writeFileSync('test-db-out.txt', 'start\n')

const pg = new EmbeddedPostgres({
  databaseDir: '.pgdata-test',
  user: 'postgres',
  password: 'pw',
  port: 5435,
  persistent: false,
})

let client

async function run() {
  try {
    log('initialising...')
    await pg.initialise()
    log('starting...')
    await pg.start()
    log('creating db...')
    await pg.createDatabase('atlas')
    
    // Connect with pg client
    client = new Client({
      host: 'localhost',
      port: 5435,
      user: 'postgres',
      password: 'pw',
      database: 'atlas',
    })
    await client.connect()
    log('connected to postgres')
    
    const r = await client.query('select version() as v')
    log('REAL POSTGRES: ' + r.rows[0].v)
    
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