/**
 * migrate.js — idempotent migration runner (runs at app boot)
 *
 * - Ensures schema_migrations exists.
 * - Reads every migrations/*.sql (resolved relative to this file's __dirname,
 *   i.e. server/../migrations), sorted ascending by filename.
 * - For each .sql file not yet recorded in schema_migrations:
 *     BEGIN; run the whole file via pool.query(contents); INSERT filename; COMMIT
 *   On error: ROLLBACK and throw.
 * - Safe to re-run; already-applied files are skipped (debug-level note).
 * - Never logs secrets (does not log DATABASE_URL or query params).
 *
 * Direct invocation:  node server/migrate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool, query } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Ensure the bookkeeping table exists. Plain CREATE IF NOT EXISTS; not wrapped
 * in an explicit transaction (DDL like this is auto-committed per statement).
 */
async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * List already-applied migration filenames.
 * @returns {Promise<Set<string>>}
 */
async function getAppliedFilenames() {
  const { rows } = await query('SELECT filename FROM schema_migrations;');
  return new Set(rows.map((r) => r.filename));
}

/**
 * List candidate .sql files in MIGRATIONS_DIR, sorted ascending.
 * @returns {string[]} filenames (basename only)
 */
function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // ascending lexicographic — matches convention 001_, 002_, ...
}

/**
 * Apply a single migration file inside a transaction. The entire file contents
 * are sent in one pool.query() call; node-postgres supports multi-statement
 * scripts when no parameters are passed.
 *
 * @param {string} filename   basename of the .sql file
 * @param {string} contents   raw file contents (UTF-8)
 */
async function applyMigration(filename, contents) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');
    // Run the whole file as one multi-statement script (no params).
    await client.query(contents);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1);',
      [filename]
    );
    await client.query('COMMIT;');
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch (_) {
      // Ignore rollback failure; original error is what matters.
    }
    // Do not echo `contents` or err.detail (may include context). Throw generic.
    const safe = new Error(`Migration failed: ${filename}`);
    safe.code = err.code || 'MIGRATION_ERROR';
    safe.cause = err.code || undefined; // SQLSTATE only, never raw message
    throw safe;
  } finally {
    client.release();
  }
}

/**
 * runMigrations — entry point. Ensures the bookkeeping table, then applies any
 * pending .sql files in order. Returns the list of applied filenames.
 * @returns {Promise<string[]>}
 */
async function runMigrations() {
  await ensureMigrationsTable();

  const applied = await getAppliedFilenames();
  const files = listMigrationFiles();

  const newlyApplied = [];

  for (const filename of files) {
    if (applied.has(filename)) {
      // Debug-level note. Use console.log only when DEBUG to avoid noise.
      if (process.env.DEBUG_MIGRATIONS) {
        console.log(`[migrate] skip (already applied): ${filename}`);
      }
      continue;
    }

    const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    await applyMigration(filename, contents);
    newlyApplied.push(filename);
    console.log(`[migrate] applied: ${filename}`);
  }

  if (newlyApplied.length === 0 && process.env.DEBUG_MIGRATIONS) {
    console.log('[migrate] no pending migrations');
  }

  return newlyApplied;
}

// ---------------------------------------------------------------------------
// Direct invocation:  node server/migrate.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  runMigrations()
    .then((applied) => {
      console.log(
        applied.length
          ? `[migrate] migrations complete (${applied.length} applied).`
          : '[migrate] migrations complete (nothing to apply).'
      );
      return require('./db').end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] ERROR:', err.message || err);
      process.exit(1);
    });
}

module.exports = {
  runMigrations,
  ensureMigrationsTable,
  listMigrationFiles,
  applyMigration,
  MIGRATIONS_DIR,
};
