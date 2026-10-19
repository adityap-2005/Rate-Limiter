import type { Request, Response, NextFunction } from "express";
import redisClient from "../config/redis.js";

const rateLimitScript = `
    local current = redis.call('INCR', KEYS[1])

    if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end

    local ttl = redis.call('PTTL', KEYS[1])

    return {current, ttl}
`;
interface RateLimiterOptions {
    limit: number;
    windowMs: number;
    keyPrefix: string
}

export const rateLimiter = (options: RateLimiterOptions) => {
    if (
        !Number.isInteger(options.limit) ||
        options.limit <= 0 ||
        !Number.isFinite(options.windowMs) ||
        options.windowMs <= 0 ||
        typeof options.keyPrefix !== "string" ||
        options.keyPrefix.trim().length === 0
    ) {
        throw new Error("Invalid rate limiter configuration");
    }

    const middleware = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {

            const ip = req.ip ?? "unknown";
            const key = `rate-limit:${options.keyPrefix}:${ip}`;
            res.setHeader("X-RateLimit-Limit", options.limit);

            const result = await redisClient.eval(rateLimitScript, {
                keys: [key],
                arguments: [String(options.windowMs)],
            });

            if (!Array.isArray(result) || result.length !== 2) {
                throw new Error("Unexpected Redis rate limiter script response");
            }

            const count = Number(result[0]);
            const ttl = Number(result[1]);

            if (
                !Number.isSafeInteger(count) ||
                count <= 0 ||
                !Number.isSafeInteger(ttl) ||
                ttl < 0
            ) {
                throw new Error("Invalid Redis rate limiter script response");
            }

            res.setHeader("X-RateLimit-Remaining", Math.max(0, options.limit - count));

            if (count > options.limit) {
                res.setHeader("Retry-After", Math.ceil(ttl / 1000));
                return res.status(429).json({
                    error: "Too many requests",
                    message: "Rate limit exceeded. Try again later."
                })
            }

            return next();
        } catch (error) {
            console.error("Rate limiter Redis error:", error);

            return res.status(503).json({
                error: "Service unavailable",
                message: "Rate limiting is temporarily unavailable."
            });
        }

    }

    return middleware;
}