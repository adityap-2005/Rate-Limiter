import type { Request, Response, NextFunction } from "express";
import redisClient from "../config/redis.js";
import { randomUUID } from "node:crypto";

interface SlidingWindowOptions {
    limit: number,
    windowMs: number,
    keyPrefix: string
}

const slidingWindowScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowMs = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local requestId = ARGV[4]

    local windowStart = now - windowMs

    redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

    local count = redis.call('ZCARD', key)

    if count >= limit then
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        return {0, count, tonumber(oldest[2])}
    end

    redis.call('ZADD', key, now, requestId)
    redis.call('PEXPIRE', key, windowMs)

    return {1, count + 1, 0}
`;

const validOptions = (options: SlidingWindowOptions) => {
    if (
        !Number.isInteger(options.limit) ||
        options.limit <= 0 ||
        !Number.isSafeInteger(options.windowMs) ||
        options.windowMs <= 0 ||
        typeof options.keyPrefix !== "string" ||
        options.keyPrefix.trim().length === 0
    ) {
        throw new Error("Invalid sliding window rate limiter configuration");
    }
};

export const slidingWindowRateLimiter = (options: SlidingWindowOptions) => {
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
            const requestId = randomUUID();

            const result = await redisClient.eval(slidingWindowScript, {
                keys: [key],
                arguments: [
                    String(now),
                    String(options.windowMs),
                    String(options.limit),
                    requestId,
                ]
            });

            if (!Array.isArray(result) || result.length !== 3) {
                throw new Error("Unexpected sliding window script response");
            }
            
            const allowed = Number(result[0]);
            const count = Number(result[1]);
            const oldest = Number(result[2]);
            
            if (
                !Number.isSafeInteger(allowed) ||
                (allowed !== 0 && allowed !== 1) ||
                !Number.isSafeInteger(count) ||
                count < 0 ||
                !Number.isSafeInteger(oldest) ||
                (allowed === 0 && oldest <= 0)
            ) {
                throw new Error("Invalid sliding window script response");
            }

            res.setHeader("X-RateLimit-Limit", options.limit);
            res.setHeader(
                "X-RateLimit-Remaining",
                Math.max(0, options.limit - count)
            );

            if (allowed === 0) {
                const retryAfter = Math.max(
                    1,
                    Math.ceil((oldest + options.windowMs - now) / 1000)
                );
            
                res.setHeader("Retry-After", retryAfter);
            
                return res.status(429).json({
                    error: "Too many requests",
                    message: "Rate limit exceeded. Try again later.",
                });
            }
            
            return next();
        } catch (error) {
            console.error("Sliding window rate limiter Redis error:", error);

            return res.status(503).json({
                error: "Service Unavailable",
                message: "Rate Limiting is temporary unavailable"
            });
        }
    }
    return middleware;
}