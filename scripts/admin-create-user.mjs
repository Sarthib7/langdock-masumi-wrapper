#!/usr/bin/env node
/**
 * Create or rotate an admin login row in the auth database.
 *
 * Usage:
 *   npm run admin:create-user -- --username alice --display "Alice"
 *
 * Optional flags:
 *   --email <addr>
 *   --password <pw>            (skip the interactive prompt; not echoed if not set)
 *
 * Reads from the same DATABASE_URL / DB_PATH the server uses; runs against
 * Postgres when DATABASE_URL is set, else the local sql.js file.
 *
 * Build the project first: `npm run build`.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const username = arg("username");
const displayName = arg("display");
const email = arg("email");
let password = arg("password");

if (!username) {
  console.error("Usage: npm run admin:create-user -- --username <name> [--display <name>] [--email <addr>]");
  process.exit(1);
}

if (!password) {
  const rl = createInterface({ input, output });
  password = await rl.question(`Password for ${username}: `);
  rl.close();
}

if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const id = randomUUID();

// Load the dispatcher from the compiled dist/ output so we use the same
// adapter selection logic as the server.
const { createUser, findUserByUsername, deleteUser, closeDb, databaseKind } =
  await import("../dist/services/database.js");

const kind = await databaseKind();
console.log(`Using ${kind} adapter.`);

const existing = await findUserByUsername(username);
if (existing) {
  console.log(`User "${username}" already exists. Rotating password.`);
  await deleteUser(existing.id);
}

await createUser(id, username, hash, email, displayName);
console.log(`✓ Created user "${username}" (id=${id}).`);

await closeDb();
