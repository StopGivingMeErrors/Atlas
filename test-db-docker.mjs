import { Client } from 'pg'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const CONTAINER_NAME = 'atlas-test-db'
const PORT = 5436
const DB_NAME = 'atlas'
const USER = 'postgres'
const PASSWORD = 'pw'

const log = (m) => {
  console.log(m)
  fs.appendFileSync('test-db-docker-out.txt', m + '\n')
}

async function run() {
  try {
    // Stop and remove existing container
    log('Cleaning up existing container...')
    try { execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' }) } catch {}
    try { execSync(`docker rm ${CONTAINER_NAME}`, { stdio: 'ignore' }) } catch {}
    
    // Start PostgreSQL container
    log('Starting PostgreSQL container...')
    execSync(`docker run -d --name ${CONTAINER_NAME} -e POSTGRES_USER=${USER} -e POSTGRES_PASSWORD=${PASSWORD} -e POSTGRES_DB=${DB_NAME} -p ${PORT}:5432 postgres:16`, { stdio: 'inherit' })
    
    // Wait for PostgreSQL to be ready
    log('Waiting for PostgreSQL to be ready...')
    let retries = 30
    while (retries > 0) {
      try {
        execSync(`docker exec ${CONTAINER_NAME} pg_isready -U ${USER}`, { stdio: 'ignore' })
        break
      } catch {
        await new Promise(r => setTimeout(r, 1000))
        retries--
      }
    }
    if (retries === 0) throw new Error('PostgreSQL did not become ready in time')
    log('PostgreSQL is ready')
    
    // Connect and apply migrations
    const client = new Client({
      host: 'localhost',
      port: PORT,
      user: USER,
      password: PASSWORD,
      database: DB_NAME,
    })
    await client.connect()
    log('Connected to PostgreSQL')
    
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
    
    await client.end()
    log('Client disconnected')
    
  } catch (e) {
    log('FAILED: ' + e.message + '\n' + e.stack)
    process.exit(1)
  }
}

run()