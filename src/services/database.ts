/**
 * SQLite database for user authentication and session management.
 *
 * Uses sql.js (WASM-based SQLite) — zero native compilation, works on any
 * platform including Alpine Docker images without Python/build-tools.
 *
 * The database is loaded from DB_PATH (default: data/auth.db) on first use
 * and auto-saved after every write operation.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

let db: SqlJsDatabase | undefined;
let dbPathValue: string;

function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "auth.db");
}

async function loadDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  dbPathValue = dbPath();
  mkdirSync(path.dirname(dbPathValue), { recursive: true });

  const SQL = await initSqlJs();

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
    writeFileSync(dbPathValue, buffer);
  }
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
}

export async function createUser(
  id: string,
  username: string,
  passwordHash: string,
  email?: string,
  displayName?: string,
): Promise<UserRow> {
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
}

export async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const database = await loadDb();
  const stmt = database.prepare("SELECT * FROM users WHERE username = ?");
  stmt.bind([username]);
  try {
    if (stmt.step()) {
      return rowToUser(stmt);
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const database = await loadDb();
  const stmt = database.prepare("SELECT * FROM users WHERE id = ?");
  stmt.bind([id]);
  try {
    if (stmt.step()) {
      return rowToUser(stmt);
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

export async function listUsers(): Promise<Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">[]> {
  const database = await loadDb();
  const stmt = database.prepare("SELECT id, username, email, display_name, created_at FROM users ORDER BY created_at");
  const results: Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">[] = [];
  while (stmt.step()) {
    const row: Record<string, unknown> = {};
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    columns.forEach((col, i) => { row[col] = values[i]; });
    results.push(row as Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">);
  }
  stmt.free();
  return results;
}

export async function deleteUser(id: string): Promise<boolean> {
  const database = await loadDb();
  database.run("DELETE FROM sessions WHERE user_id = ?", [id]);
  database.run("DELETE FROM users WHERE id = ?", [id]);
  save();
  return true;
}

export async function createSession(
  id: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  const database = await loadDb();
  database.run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, tokenHash, new Date().toISOString(), expiresAt.toISOString()],
  );
  save();
}

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionRow | undefined> {
  const database = await loadDb();
  const stmt = database.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?");
  stmt.bind([tokenHash, new Date().toISOString()]);
  try {
    if (stmt.step()) {
      return rowToSession(stmt);
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

export async function deleteSession(id: string): Promise<void> {
  const database = await loadDb();
  database.run("DELETE FROM sessions WHERE id = ?", [id]);
  save();
}

export async function deleteExpiredSessions(): Promise<number> {
  const database = await loadDb();
  database.run("DELETE FROM sessions WHERE expires_at <= ?", [new Date().toISOString()]);
  save();
  return 0;
}

export async function deleteUserSessions(userId: string): Promise<void> {
  const database = await loadDb();
  database.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  save();
}

/** Close the database connection. Used in tests. */
export function closeDb(): void {
  if (db) {
    save();
    db.close();
    db = undefined;
  }
}

/** Reset the database module state. Used in tests. */
export function resetDb(): void {
  closeDb();
}

// ── Helpers ──────────────────────────────────────────────────────────

function rowToUser(stmt: import("sql.js").Statement): UserRow {
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => { row[col] = values[i]; });
  return row as unknown as UserRow;
}

function rowToSession(stmt: import("sql.js").Statement): SessionRow {
  const columns = stmt.getColumnNames();
  const values = stmt.get();
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => { row[col] = values[i]; });
  return row as unknown as SessionRow;
}
