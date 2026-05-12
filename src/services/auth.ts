/**
 * Authentication service — password hashing, session token generation, and verification.
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  findUserByUsername,
  findUserById,
  findSessionByTokenHash,
  createUser as createUserRow,
  createSession as createSessionRow,
  deleteUserSessions,
  deleteSession,
  deleteExpiredSessions,
  type UserRow,
} from "./database.js";

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 24;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateSessionToken(): string {
  return randomUUID() + "-" + randomUUID();
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
}

export async function registerUser(
  username: string,
  password: string,
  email?: string,
  displayName?: string,
): Promise<{ user: AuthenticatedUser; token: string } | { error: string }> {
  const trimmed = username.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return { error: "Username must be 3–32 characters." };
  }
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    return {
      error: "Username can only contain lowercase letters, numbers, hyphens, and underscores.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = findUserByUsername(trimmed);
  if (existing) {
    return { error: "Username already taken." };
  }

  const passwordHash = await hashPassword(password);
  const user = createUserRow(randomUUID(), trimmed, passwordHash, email, displayName);

  const { token } = await createSessionForUser(user);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
    },
    token,
  };
}

export async function loginUser(
  username: string,
  password: string,
): Promise<{ user: AuthenticatedUser; token: string } | { error: string }> {
  const trimmed = username.trim().toLowerCase();
  const user = findUserByUsername(trimmed);
  if (!user) {
    return { error: "Invalid username or password." };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return { error: "Invalid username or password." };
  }

  const { token } = await createSessionForUser(user);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
    },
    token,
  };
}

async function createSessionForUser(
  user: UserRow,
): Promise<{ token: string }> {
  deleteExpiredSessions();

  const token = generateSessionToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
  );

  createSessionRow(randomUUID(), user.id, tokenHash, expiresAt);

  return { token };
}

export function verifyToken(token: string): AuthenticatedUser | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = findSessionByTokenHash(tokenHash);
  if (!session) return null;

  const user = findUserById(session.user_id);
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
  };
}

export function logoutUser(token: string): void {
  if (!token) return;
  const tokenHash = sha256(token);
  const session = findSessionByTokenHash(tokenHash);
  if (session) {
    deleteSession(session.id);
  }
}

export function logoutAllSessions(userId: string): void {
  deleteUserSessions(userId);
}
