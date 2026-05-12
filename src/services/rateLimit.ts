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

export function checkRateLimit(args: {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
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
