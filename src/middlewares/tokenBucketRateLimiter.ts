import type { Request, Response, NextFunction } from "express";
import redisClient from "../config/redis.js";

interface TokenBucketOptions {
    capacity: number;
    refillRate: number;
    keyPrefix: string;
}


const tokenBucketScript = `
    local key = KEYS[1]

    local capacity = tonumber(ARGV[1])
    local refillRate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])

    local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')

    local tokens = tonumber(bucket[1])
    local lastRefill = tonumber(bucket[2])

    if tokens == nil then
        tokens = capacity
        lastRefill = now
    end

    local effectiveNow = math.max(now, lastRefill)
    local elapsed = effectiveNow - lastRefill
    local refill = elapsed * refillRate / 1000

    tokens = math.min(capacity, tokens + refill)

    local allowed = 0

    if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
    end

    redis.call('HSET', key,
        'tokens', tokens,
        'lastRefill', effectiveNow
    )

    local ttl = math.ceil(capacity / refillRate * 1000)
    redis.call('PEXPIRE', key, math.max(1, ttl))

    return {allowed, tokens}
`;


const validOptions = (options: TokenBucketOptions) => {
    if (
        !Number.isInteger(options.capacity) ||
        options.capacity <= 0 ||
        !Number.isFinite(options.refillRate) ||
        options.refillRate <= 0 ||
        typeof options.keyPrefix !== "string" ||
        options.keyPrefix.trim().length === 0
    ) {
        throw new Error("Invalid token bucket rate limiter configuration");
    }
};

export const tokenBucketRateLimiter = (options: TokenBucketOptions) => {
    validOptions(options);

    const middleware = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            const ip = req.ip ?? "unknown";
            const key = `rate-limit:${options.keyPrefix}:${ip}`;

            const now = Date.now();

            const result = await redisClient.eval(tokenBucketScript, {
                keys: [key],
                arguments: [
                    String(options.capacity),
                    String(options.refillRate),
                    String(now)
                ]
            });


            if (!Array.isArray(result) || result.length !== 2) {
                throw new Error("Unexpected token bucket script response");
            }

            const allowed = Number(result[0]);
            const tokens = Number(result[1]);

            if (
                !Number.isSafeInteger(allowed) ||
                (allowed !== 0 && allowed !== 1) ||
                !Number.isFinite(tokens) ||
                tokens < 0 ||
                tokens > options.capacity
            ) {
                throw new Error("Invalid token bucket script response");
            }


            res.setHeader("X-RateLimit-Limit", options.capacity);
            res.setHeader("X-RateLimit-Remaining", Math.floor(tokens));

            if (allowed === 1) {
                return next();
            }

            const retryAfter = Math.max(
                1,
                Math.ceil((1 - tokens) / options.refillRate)
            );

            res.setHeader("Retry-After", retryAfter);

            return res.status(429).json({
                error: "Too many requests",
                message: "Rate limit exceeded. Try again later.",
            });
        } catch (error) {
            console.error("Token bucket rate limiter Redis error :", error);

            return res.status(503).json({
                error: "Service Unavailable",
                message: "Rate Limiting is temporary unavailable"
            });
        }
    }
    return middleware;
}