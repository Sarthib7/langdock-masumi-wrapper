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
} from "./database.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  hashOpaqueToken,
} from "./opaqueTokens.js";

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 24;
const ADMIN_SESSION_USER_ID = "setup-admin";

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

export async function verifyAdminCredentials(
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

export async function loginAdmin(
  username: string,
  password: string,
): Promise<{ user: AuthenticatedUser; token: string } | { error: string }> {
  if (!adminCredentialsConfigured()) {
    return {
      error:
        "Admin credentials are not configured. Set SETUP_USERNAME and SETUP_PASSWORD_HASH or SETUP_PASSWORD.",
    };
  }

  if (!(await verifyAdminCredentials(username, password))) {
    return { error: "Invalid username or password." };
  }

  const { token } = await createSessionForAdmin();

  return {
    user: configuredAdminUser(),
    token,
  };
}

async function createSessionForAdmin(): Promise<{ token: string }> {
  await deleteExpiredSessions();

  const token = generateSessionToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
  );

  await createSessionRow(randomUUID(), ADMIN_SESSION_USER_ID, tokenHash, expiresAt);

  return { token };
}

export async function verifyToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const tokenHash = hashOpaqueToken(token);
  const session = await findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (session.user_id !== ADMIN_SESSION_USER_ID) return null;
  if (!adminCredentialsConfigured()) return null;
  return configuredAdminUser();
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
