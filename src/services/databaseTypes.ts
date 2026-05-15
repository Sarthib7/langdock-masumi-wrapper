/**
 * Adapter-agnostic shape for the auth database. The dispatcher in
 * `database.ts` picks an implementation (sql.js or Postgres) at first use.
 */

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

export type UserSummary = Pick<
  UserRow,
  "id" | "username" | "email" | "display_name" | "created_at"
>;

export interface DatabaseAdapter {
  kind: "sqljs" | "postgres";

  createUser(
    id: string,
    username: string,
    passwordHash: string,
    email?: string,
    displayName?: string,
  ): Promise<UserRow>;
  findUserByUsername(username: string): Promise<UserRow | undefined>;
  findUserById(id: string): Promise<UserRow | undefined>;
  listUsers(): Promise<UserSummary[]>;
  deleteUser(id: string): Promise<boolean>;

  createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(): Promise<number>;
  deleteUserSessions(userId: string): Promise<void>;

  close(): void | Promise<void>;
}
