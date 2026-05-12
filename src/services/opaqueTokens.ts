import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return sha256Hex(token);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

export function verifyOpaqueToken(token: string, expectedHash: string): boolean {
  return constantTimeEqual(hashOpaqueToken(token), expectedHash);
}
