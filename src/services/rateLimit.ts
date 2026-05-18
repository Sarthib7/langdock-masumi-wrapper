export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 30_000;

function sweepExpired(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS && buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Hard cap: if the map is still over budget, drop the oldest entries.
  if (buckets.size > MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      if (dropped >= overflow) break;
      buckets.delete(key);
      dropped += 1;
    }
  }
  lastSweep = now;
}

export function checkRateLimit(args: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);
  const key = `${args.scope}:${args.identifier}`;
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + args.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(args.limit - bucket.count, 0);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1000),
  );

  return {
    allowed: bucket.count <= args.limit,
    limit: args.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
  };
}

export function __resetRateLimitsForTests(): void {
  buckets.clear();
}
