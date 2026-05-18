/**
 * Auth database dispatcher.
 *
 * Picks an adapter at first use:
 * - `DATABASE_URL` set → Postgres adapter (Railway Postgres plugin, etc.).
 * - otherwise → sql.js file adapter at `DB_PATH` or `data/auth.db`.
 *
 * The public surface (functions exported below) is stable — handler code in
 * `auth.ts`, `setup.ts`, and the test suite never sees which adapter is in
 * use.
 */

import type {
  DatabaseAdapter,
  SessionRow,
  UserRow,
  UserSummary,
} from "./databaseTypes.js";

let adapter: DatabaseAdapter | undefined;

function selectAdapterKind(): "postgres" | "sqljs" {
  return process.env.DATABASE_URL?.trim() ? "postgres" : "sqljs";
}

async function getAdapter(): Promise<DatabaseAdapter> {
  if (adapter) return adapter;
  const kind = selectAdapterKind();
  if (kind === "postgres") {
    const { createPgAdapter } = await import("./databasePg.js");
    adapter = createPgAdapter(process.env.DATABASE_URL as string);
  } else {
    const { createSqlJsAdapter } = await import("./databaseSqlJs.js");
    adapter = createSqlJsAdapter();
  }
  return adapter;
}

export type { UserRow, SessionRow } from "./databaseTypes.js";

export async function databaseKind(): Promise<DatabaseAdapter["kind"]> {
  return (await getAdapter()).kind;
}

export async function createUser(
  id: string,
  username: string,
  passwordHash: string,
  email?: string,
  displayName?: string,
): Promise<UserRow> {
  return (await getAdapter()).createUser(id, username, passwordHash, email, displayName);
}

export async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  return (await getAdapter()).findUserByUsername(username);
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  return (await getAdapter()).findUserById(id);
}

export async function listUsers(): Promise<UserSummary[]> {
  return (await getAdapter()).listUsers();
}

export async function deleteUser(id: string): Promise<boolean> {
  return (await getAdapter()).deleteUser(id);
}

export async function createSession(
  id: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  return (await getAdapter()).createSession(id, userId, tokenHash, expiresAt);
}

export async function findSessionByTokenHash(
  tokenHash: string,
): Promise<SessionRow | undefined> {
  return (await getAdapter()).findSessionByTokenHash(tokenHash);
}

export async function deleteSession(id: string): Promise<void> {
  return (await getAdapter()).deleteSession(id);
}

export async function deleteExpiredSessions(): Promise<number> {
  return (await getAdapter()).deleteExpiredSessions();
}

export async function deleteUserSessions(userId: string): Promise<void> {
  return (await getAdapter()).deleteUserSessions(userId);
}

/** Close the database connection. Used in tests and on graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = undefined;
  }
}

/** Reset the dispatcher state. Used between test cases. */
export function resetDb(): void {
  // Fire-and-forget close to keep the API synchronous for existing tests;
  // sql.js close is sync and Postgres close happens out-of-band.
  if (adapter) {
    void adapter.close();
    adapter = undefined;
  }
}
