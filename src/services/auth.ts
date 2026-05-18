/**
 * Authentication service — admin password verification, session token generation,
 * and session verification.
 */

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  findSessionByTokenHash,
  createSession as createSessionRow,
  deleteUserSessions,
  deleteSession,
  deleteExpiredSessions,
  findUserById,
  findUserByUsername,
  listUsers,
  type UserRow,
} from "./database.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  hashOpaqueToken,
} from "./opaqueTokens.js";

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 24;
const ADMIN_SESSION_USER_ID = "setup-admin";
const DUMMY_BCRYPT_HASH =
  "$2b$12$abcdefghijklmnopqrstuuK7r2cFOP7JPrbMV7xYUq/xp1n0JRXD6";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return generateOpaqueToken(32);
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
}

type DatabaseCredentialCheck =
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "invalid" }
  | { status: "not_found" };

type LoginResult =
  | { user: AuthenticatedUser; token: string }
  | { error: string; credentialsConfigured: boolean };

function configuredAdminUsername(): string {
  return process.env.SETUP_USERNAME?.trim() ?? "";
}

function configuredAdminPasswordHash(): string {
  return process.env.SETUP_PASSWORD_HASH?.trim() ?? "";
}

function configuredAdminPassword(): string {
  return process.env.SETUP_PASSWORD ?? "";
}

export function adminCredentialsConfigured(): boolean {
  return Boolean(
    configuredAdminUsername() &&
      (configuredAdminPasswordHash() || configuredAdminPassword()),
  );
}

function configuredAdminUser(): AuthenticatedUser {
  const username = configuredAdminUsername();
  return {
    id: ADMIN_SESSION_USER_ID,
    username,
    displayName: username,
    email: null,
  };
}

function userRowToAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
  };
}

async function databaseHasUsers(): Promise<boolean> {
  return (await listUsers()).length > 0;
}

async function verifyDatabaseCredentials(
  username: string,
  password: string,
): Promise<DatabaseCredentialCheck> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) return { status: "not_found" };

  const user = await findUserByUsername(normalizedUsername);
  if (!user) {
    // Keep bcrypt timing broadly similar for unknown users.
    await verifyPassword(password || "missing-password", DUMMY_BCRYPT_HASH);
    return { status: "not_found" };
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    return { status: "invalid" };
  }

  return {
    status: "authenticated",
    user: userRowToAuthenticatedUser(user),
  };
}

async function verifyConfiguredAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const expectedUsername = configuredAdminUsername();
  const passwordHash = configuredAdminPasswordHash();
  const passwordPlaintext = configuredAdminPassword();

  if (!expectedUsername || (!passwordHash && !passwordPlaintext)) return false;
  if (!constantTimeEqual(username.trim(), expectedUsername)) return false;

  if (passwordHash) {
    return verifyPassword(password, passwordHash);
  }

  return constantTimeEqual(password, passwordPlaintext);
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const dbCheck = await verifyDatabaseCredentials(username, password);
  if (dbCheck.status === "authenticated") return true;
  if (dbCheck.status === "invalid") return false;

  return verifyConfiguredAdminCredentials(username, password);
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<LoginResult> {
  const dbCheck = await verifyDatabaseCredentials(username, password);
  if (dbCheck.status === "authenticated") {
    const { token } = await createSessionForUser(dbCheck.user.id);
    return {
      user: dbCheck.user,
      token,
    };
  }
  if (dbCheck.status === "invalid") {
    return {
      error: "Invalid username or password.",
      credentialsConfigured: true,
    };
  }

  if (adminCredentialsConfigured()) {
    if (!(await verifyConfiguredAdminCredentials(username, password))) {
      return {
        error: "Invalid username or password.",
        credentialsConfigured: true,
      };
    }

    const { token } = await createSessionForUser(ADMIN_SESSION_USER_ID);

    return {
      user: configuredAdminUser(),
      token,
    };
  }

  if (await databaseHasUsers()) {
    return {
      error: "Invalid username or password.",
      credentialsConfigured: true,
    };
  }

  return {
    error:
      "Admin credentials are not configured. Create an admin user with `npm run admin:create-user` or set SETUP_USERNAME and SETUP_PASSWORD_HASH.",
    credentialsConfigured: false,
  };
}

async function createSessionForUser(userId: string): Promise<{ token: string }> {
  await deleteExpiredSessions();

  const token = generateSessionToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
  );

  await createSessionRow(randomUUID(), userId, tokenHash, expiresAt);

  return { token };
}

export async function verifyToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const tokenHash = hashOpaqueToken(token);
  const session = await findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (session.user_id === ADMIN_SESSION_USER_ID) {
    if (!adminCredentialsConfigured()) return null;
    return configuredAdminUser();
  }

  const user = await findUserById(session.user_id);
  if (!user) {
    await deleteSession(session.id);
    return null;
  }
  return userRowToAuthenticatedUser(user);
}

export async function logoutUser(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashOpaqueToken(token);
  const session = await findSessionByTokenHash(tokenHash);
  if (session) {
    await deleteSession(session.id);
  }
}

export async function logoutAllSessions(userId: string): Promise<void> {
  await deleteUserSessions(userId);
}
