/**
 * sql.js (WASM SQLite) adapter for the auth database.
 *
 * Used when `DATABASE_URL` is not set — local development and the legacy
 * single-replica Railway deploy. The file is locked to mode 0o600 on every
 * save.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseAdapter, SessionRow, UserRow } from "./databaseTypes.js";

const requireFromHere = createRequire(import.meta.url);

let db: SqlJsDatabase | undefined;
let dbPathValue: string;

function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "auth.db");
}

async function loadDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  dbPathValue = dbPath();
  mkdirSync(path.dirname(dbPathValue), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      try {
        return requireFromHere.resolve(`sql.js/dist/${file}`);
      } catch {
        return file;
      }
    },
  });

  if (existsSync(dbPathValue)) {
    const buffer = readFileSync(dbPathValue);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`);

  save();
  return db;
}

function save(): void {
  if (db && dbPathValue) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPathValue, buffer, { mode: 0o600 });
    chmodSync(dbPathValue, 0o600);
  }
}

function rowToUser(stmt: import("sql.js").Statement): UserRow {
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => {
    row[col] = values[i];
  });
  return row as unknown as UserRow;
}

function rowToSession(stmt: import("sql.js").Statement): SessionRow {
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => {
    row[col] = values[i];
  });
  return row as unknown as SessionRow;
}

export function createSqlJsAdapter(): DatabaseAdapter {
  return {
    kind: "sqljs",

    async createUser(id, username, passwordHash, email, displayName) {
      const database = await loadDb();
      const now = new Date().toISOString();
      database.run(
        `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, username, email || null, passwordHash, displayName || null, now, now],
      );
      save();
      return {
        id,
        username,
        email: email || null,
        password_hash: passwordHash,
        display_name: displayName || null,
        created_at: now,
        updated_at: now,
      };
    },

    async findUserByUsername(username) {
      const database = await loadDb();
      const stmt = database.prepare("SELECT * FROM users WHERE username = ?");
      stmt.bind([username]);
      try {
        if (stmt.step()) return rowToUser(stmt);
        return undefined;
      } finally {
        stmt.free();
      }
    },

    async findUserById(id) {
      const database = await loadDb();
      const stmt = database.prepare("SELECT * FROM users WHERE id = ?");
      stmt.bind([id]);
      try {
        if (stmt.step()) return rowToUser(stmt);
        return undefined;
      } finally {
        stmt.free();
      }
    },

    async listUsers() {
      const database = await loadDb();
      const stmt = database.prepare(
        "SELECT id, username, email, display_name, created_at FROM users ORDER BY created_at",
      );
      const results: Array<
        Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">
      > = [];
      while (stmt.step()) {
        const row: Record<string, unknown> = {};
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        columns.forEach((col, i) => {
          row[col] = values[i];
        });
        results.push(
          row as Pick<
            UserRow,
            "id" | "username" | "email" | "display_name" | "created_at"
          >,
        );
      }
      stmt.free();
      return results;
    },

    async deleteUser(id) {
      const database = await loadDb();
      database.run("DELETE FROM sessions WHERE user_id = ?", [id]);
      database.run("DELETE FROM users WHERE id = ?", [id]);
      save();
      return true;
    },

    async createSession(id, userId, tokenHash, expiresAt) {
      const database = await loadDb();
      database.run(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, userId, tokenHash, new Date().toISOString(), expiresAt.toISOString()],
      );
      save();
    },

    async findSessionByTokenHash(tokenHash) {
      const database = await loadDb();
      const stmt = database.prepare(
        "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?",
      );
      stmt.bind([tokenHash, new Date().toISOString()]);
      try {
        if (stmt.step()) return rowToSession(stmt);
        return undefined;
      } finally {
        stmt.free();
      }
    },

    async deleteSession(id) {
      const database = await loadDb();
      database.run("DELETE FROM sessions WHERE id = ?", [id]);
      save();
    },

    async deleteExpiredSessions() {
      const database = await loadDb();
      database.run("DELETE FROM sessions WHERE expires_at <= ?", [
        new Date().toISOString(),
      ]);
      save();
      return 0;
    },

    async deleteUserSessions(userId) {
      const database = await loadDb();
      database.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
      save();
    },

    close() {
      if (db) {
        save();
        db.close();
        db = undefined;
      }
    },
  };
}
