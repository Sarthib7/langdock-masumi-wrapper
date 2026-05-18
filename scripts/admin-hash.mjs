#!/usr/bin/env node
/**
 * Print a bcrypt hash for a password. Use with SETUP_PASSWORD_HASH.
 *
 * Usage:
 *   npm run admin:hash                  (prompts interactively)
 *   npm run admin:hash -- --password X  (one-shot; less safe — shell history)
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

let password = arg("password");
if (!password) {
  const rl = createInterface({ input, output });
  password = await rl.question("Password to hash: ");
  rl.close();
}

if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(hash);
console.log("\nSet SETUP_PASSWORD_HASH to the value above and unset SETUP_PASSWORD.");
