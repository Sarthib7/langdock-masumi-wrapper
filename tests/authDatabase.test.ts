import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword, loginAdmin, verifyToken } from "../src/services/auth.js";
import { createUser, deleteUser, resetDb } from "../src/services/database.js";

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

  it("logs in with a database admin user when env credentials are absent", async () => {
    delete process.env.SETUP_USERNAME;
    delete process.env.SETUP_PASSWORD;
    delete process.env.SETUP_PASSWORD_HASH;

    const passwordHash = await hashPassword("db-admin-password-123");
    await createUser(
      "user-db-admin",
      "db-admin",
      passwordHash,
      "db-admin@example.com",
      "DB Admin",
    );

    const login = await loginAdmin("db-admin", "db-admin-password-123");

    expect("error" in login).toBe(false);
    if ("error" in login) return;

    expect(login.user).toMatchObject({
      id: "user-db-admin",
      username: "db-admin",
      displayName: "DB Admin",
      email: "db-admin@example.com",
    });

    const user = await verifyToken(login.token);
    expect(user).toMatchObject({
      id: "user-db-admin",
      username: "db-admin",
      displayName: "DB Admin",
      email: "db-admin@example.com",
    });
  });

  it("invalidates database user sessions when the user is deleted", async () => {
    delete process.env.SETUP_USERNAME;
    delete process.env.SETUP_PASSWORD;
    delete process.env.SETUP_PASSWORD_HASH;

    await createUser(
      "user-to-delete",
      "temporary-admin",
      await hashPassword("temporary-password-123"),
    );

    const login = await loginAdmin("temporary-admin", "temporary-password-123");
    expect("error" in login).toBe(false);
    if ("error" in login) return;

    await deleteUser("user-to-delete");

    await expect(verifyToken(login.token)).resolves.toBeNull();
  });

  it("authenticates database users through the browser login endpoint", async () => {
    delete process.env.SETUP_USERNAME;
    delete process.env.SETUP_PASSWORD;
    delete process.env.SETUP_PASSWORD_HASH;

    await createUser(
      "route-user",
      "route-admin",
      await hashPassword("route-password-123"),
      undefined,
      "Route Admin",
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        mode: "login",
        username: "route-admin",
        password: "route-password-123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      id: "route-user",
      username: "route-admin",
      displayName: "Route Admin",
    });
    expect(res.headers["set-cookie"]).toContain("session=");

    await app.close();
  });

  it("returns 401 instead of setup-unconfigured when database users exist", async () => {
    delete process.env.SETUP_USERNAME;
    delete process.env.SETUP_PASSWORD;
    delete process.env.SETUP_PASSWORD_HASH;

    await createUser(
      "route-user",
      "route-admin",
      await hashPassword("route-password-123"),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        mode: "login",
        username: "route-admin",
        password: "wrong-password",
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "LOGIN_FAILED" });

    await app.close();
  });
});
