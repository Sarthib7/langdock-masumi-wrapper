import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAdmin, verifyToken } from "../src/services/auth.js";
import { resetDb } from "../src/services/database.js";

const ORIGINAL_ENV = { ...process.env };
let tempDir: string | undefined;

describe("admin auth database", () => {
  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    tempDir = await mkdtemp(path.join(tmpdir(), "langdock-auth-db-test-"));
    process.env.DB_PATH = path.join(tempDir, "auth.db");
    process.env.SETUP_USERNAME = "admin";
    process.env.SETUP_PASSWORD = "admin-password-123";
    delete process.env.SETUP_PASSWORD_HASH;
    resetDb();
  });

  afterEach(async () => {
    resetDb();
    process.env = { ...ORIGINAL_ENV };
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("creates and verifies an admin session using sql.js", async () => {
    const login = await loginAdmin("admin", "admin-password-123");

    expect("error" in login).toBe(false);
    if ("error" in login) return;

    const user = await verifyToken(login.token);
    expect(user?.username).toBe("admin");
  });
});
