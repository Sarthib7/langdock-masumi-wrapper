#!/usr/bin/env node
/**
 * Migrate the auth tables to Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-auth.mjs
 *   DATABASE_URL=postgres://... node scripts/migrate-auth.mjs --copy-from-sqljs
 *
 * Behavior:
 *   - Creates `users` and `sessions` tables if they don't exist.
 *   - With `--copy-from-sqljs`, also reads `data/auth.db` (or $DB_PATH) and
 *     copies users + sessions into Postgres. Existing rows in Postgres are
 *     left alone (INSERT ... ON CONFLICT DO NOTHING).
 *
 * Safe to run multiple times.
 */

import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (set the Railway Postgres plugin variable).");
  process.exit(1);
}

const copyFromSqlJs = process.argv.includes("--copy-from-sqljs");

const { Pool } = await import("pg");
const requiresSsl =
  /sslmode=require/i.test(DATABASE_URL) || process.env.DATABASE_SSL === "require";
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`,
  );
  console.log("✓ Schema ready (users, sessions, indexes).");

  if (copyFromSqlJs) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "auth.db");
    if (!existsSync(dbPath)) {
      console.log(`No sql.js file at ${dbPath}; nothing to copy.`);
    } else {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs({
        locateFile: (file) => {
          try {
            return requireFromHere.resolve(`sql.js/dist/${file}`);
          } catch {
            return file;
          }
        },
      });
      const buffer = readFileSync(dbPath);
      const sourceDb = new SQL.Database(buffer);

      const userStmt = sourceDb.prepare("SELECT * FROM users");
      let userCount = 0;
      while (userStmt.step()) {
        const row = userStmt.getAsObject();
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.username,
            row.email ?? null,
            row.password_hash,
            row.display_name ?? null,
            row.created_at,
            row.updated_at,
          ],
        );
        userCount += 1;
      }
      userStmt.free();

      const sessionStmt = sourceDb.prepare("SELECT * FROM sessions");
      let sessionCount = 0;
      while (sessionStmt.step()) {
        const row = sessionStmt.getAsObject();
        await pool.query(
          `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [row.id, row.user_id, row.token_hash, row.created_at, row.expires_at],
        );
        sessionCount += 1;
      }
      sessionStmt.free();
      sourceDb.close();

      console.log(`✓ Copied ${userCount} user(s) and ${sessionCount} session(s) from ${dbPath}.`);
    }
  }
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
