import EmbeddedPostgres from 'embedded-postgres'
import fs from 'node:fs'

const PASSWORD = process.env.ATLAS_LOCAL_PG_PASSWORD ?? 'pw'

const log = (m) => fs.appendFileSync('tmp-pg-out.txt', m + '\n')
fs.writeFileSync('tmp-pg-out.txt', 'start\n')

const pg = new EmbeddedPostgres({
  databaseDir: '.pgdata-smoke',
  user: 'postgres',
  password: PASSWORD,
  port: 5434,
  persistent: false,
})
try {
  log('initialising...')
  await pg.initialise()
  log('starting...')
  await pg.start()
  log('creating db...')
  await pg.createDatabase('atlas')
  const r = await pg.query('atlas', 'select version() as v')
  log('REAL POSTGRES: ' + r.rows[0].v)
} catch (e) {
  log('FAILED: ' + e.message + '\n' + e.stack)
} finally {
  try { await pg.stop(); log('stopped') } catch (e) { log('stop failed: ' + e.message) }
}
