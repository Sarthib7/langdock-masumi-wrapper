/**
 * SQLite database for user authentication and session management.
 *
 * Stores user credentials (hashed passwords) and active sessions.
 * The database file is created at DB_PATH (default: data/auth.db).
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

let db: Database.Database | undefined;

function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "auth.db");
}

export function getDb(): Database.Database {
  if (db) return db;

  const filePath = dbPath();
  mkdirSync(path.dirname(filePath), { recursive: true });

  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  `);

  return db;
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

export function createUser(
  id: string,
  username: string,
  passwordHash: string,
  email?: string,
  displayName?: string,
): UserRow {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, username, email || null, passwordHash, displayName || null, now, now);
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

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export function listUsers(): Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">[] {
  return getDb()
    .prepare("SELECT id, username, email, display_name, created_at FROM users ORDER BY created_at")
    .all() as Pick<UserRow, "id" | "username" | "email" | "display_name" | "created_at">[];
}

export function deleteUser(id: string): boolean {
  const result = getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  return result.changes > 0;
}

export function createSession(
  id: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, tokenHash, new Date().toISOString(), expiresAt.toISOString());
}

export function findSessionByTokenHash(tokenHash: string): SessionRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(tokenHash, new Date().toISOString()) as SessionRow | undefined;
  return row;
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteExpiredSessions(): number {
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(new Date().toISOString());
  return result.changes;
}

export function deleteUserSessions(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Close the database connection. Used in tests. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

/** Reset the database module state. Used in tests. */
export function resetDb(): void {
  closeDb();
}
