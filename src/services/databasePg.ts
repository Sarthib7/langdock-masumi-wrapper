/**
 * Postgres adapter for the auth database.
 *
 * Active when `DATABASE_URL` is set (e.g. the Railway Postgres plugin injects
 * it automatically). Lazy-imports `pg` so the sql.js path stays free of
 * native deps when DATABASE_URL is empty.
 *
 * Tables are created on demand; in production, run
 * `npm run db:migrate-auth` once to set up the schema explicitly.
 */

import type { DatabaseAdapter, SessionRow, UserRow } from "./databaseTypes.js";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};

let poolPromise: Promise<PgPool> | undefined;
let schemaReady = false;

async function getPool(connectionString: string): Promise<PgPool> {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    const pgModule = (await import("pg")) as unknown as {
      Pool: new (config: {
        connectionString: string;
        ssl?: boolean | { rejectUnauthorized: boolean };
        max?: number;
      }) => PgPool;
    };
    const Pool = pgModule.Pool;
    const requiresSsl =
      /sslmode=require/i.test(connectionString) ||
      process.env.DATABASE_SSL === "require";
    const pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
    });
    return pool;
  })();
  return poolPromise;
}

async function ensureSchema(pool: PgPool): Promise<void> {
  if (schemaReady) return;
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
  schemaReady = true;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return asString(value);
}

function toUserRow(row: Record<string, unknown>): UserRow {
  return {
    id: asString(row.id),
    username: asString(row.username),
    email: asNullableString(row.email),
    password_hash: asString(row.password_hash),
    display_name: asNullableString(row.display_name),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

function toSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: asString(row.id),
    user_id: asString(row.user_id),
    token_hash: asString(row.token_hash),
    created_at: toIsoString(row.created_at),
    expires_at: toIsoString(row.expires_at),
  };
}

export function createPgAdapter(connectionString: string): DatabaseAdapter {
  async function withPool<T>(fn: (pool: PgPool) => Promise<T>): Promise<T> {
    const pool = await getPool(connectionString);
    await ensureSchema(pool);
    return fn(pool);
  }

  return {
    kind: "postgres",

    createUser(id, username, passwordHash, email, displayName) {
      return withPool(async (pool) => {
        const now = new Date();
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, display_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [id, username, email ?? null, passwordHash, displayName ?? null, now],
        );
        return {
          id,
          username,
          email: email ?? null,
          password_hash: passwordHash,
          display_name: displayName ?? null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };
      });
    },

    findUserByUsername(username) {
      return withPool(async (pool) => {
        const result = await pool.query(
          `SELECT id, username, email, password_hash, display_name, created_at, updated_at
           FROM users WHERE username = $1`,
          [username],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? toUserRow(row) : undefined;
      });
    },

    findUserById(id) {
      return withPool(async (pool) => {
        const result = await pool.query(
          `SELECT id, username, email, password_hash, display_name, created_at, updated_at
           FROM users WHERE id = $1`,
          [id],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? toUserRow(row) : undefined;
      });
    },

    listUsers() {
      return withPool(async (pool) => {
        const result = await pool.query(
          `SELECT id, username, email, display_name, created_at
           FROM users ORDER BY created_at`,
          [],
        );
        return (result.rows as Array<Record<string, unknown>>).map((row) => ({
          id: asString(row.id),
          username: asString(row.username),
          email: asNullableString(row.email),
          display_name: asNullableString(row.display_name),
          created_at: toIsoString(row.created_at),
        }));
      });
    },

    deleteUser(id) {
      return withPool(async (pool) => {
        await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
        return true;
      });
    },

    createSession(id, userId, tokenHash, expiresAt) {
      return withPool(async (pool) => {
        await pool.query(
          `INSERT INTO sessions (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [id, userId, tokenHash, expiresAt],
        );
      });
    },

    findSessionByTokenHash(tokenHash) {
      return withPool(async (pool) => {
        const result = await pool.query(
          `SELECT id, user_id, token_hash, created_at, expires_at
           FROM sessions WHERE token_hash = $1 AND expires_at > NOW()`,
          [tokenHash],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? toSessionRow(row) : undefined;
      });
    },

    deleteSession(id) {
      return withPool(async (pool) => {
        await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
      });
    },

    async deleteExpiredSessions() {
      return withPool(async (pool) => {
        await pool.query(`DELETE FROM sessions WHERE expires_at <= NOW()`);
        return 0;
      });
    },

    deleteUserSessions(userId) {
      return withPool(async (pool) => {
        await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      });
    },

    async close() {
      if (poolPromise) {
        const pool = await poolPromise;
        await pool.end();
        poolPromise = undefined;
        schemaReady = false;
      }
    },
  };
}
