import type { Request, Response, NextFunction } from "express";
interface ClientRecord {
    count: number,
    windowStart: number
}

interface RateLimiterOptions {
    limit: number;
    windowMs: number;
}

export const rateLimiter = (options: RateLimiterOptions) => {
    if (
        !Number.isInteger(options.limit) ||
        options.limit <= 0 ||
        !Number.isFinite(options.windowMs) ||
        options.windowMs <= 0
    ) {
        throw new Error("Invalid rate limiter configuration");
    }

    const clients = new Map<string, ClientRecord>();

    function cleanupExpiredRecords() {
        const now = Date.now();

        console.log("Running rate limiter cleanup");
        for (const [ip, record] of clients) {
            const expired = now - record.windowStart >= options.windowMs;

            if (expired) {
                clients.delete(ip);
                console.log(`Removed expired record for ${ip}`)
            }
        }
    }

    const cleanupTimer = setInterval(cleanupExpiredRecords, 30 * 1000);
    cleanupTimer.unref();

    const middleware = (req: Request, res: Response, next: NextFunction) => {

        res.setHeader("X-RateLimit-Limit", options.limit);

        const ip = req.ip ?? "unknown";
        const now = Date.now();
        const record = clients.get(ip);


        if (!record || now - record.windowStart >= options.windowMs) {
            clients.set(ip, {
                count: 1,
                windowStart: now
            });

            res.setHeader("X-RateLimit-Remaining", options.limit - 1);

            return next();
        }

        if (record.count >= options.limit) {
            res.setHeader("X-RateLimit-Remaining", 0);

            return res.status(429).json({
                error: "Too many requests",
                message: "Rate limit exceeded. Try again later."
            })
        }

        record.count++;
        res.setHeader("X-RateLimit-Remaining", options.limit - record.count);
        return next();
    }

    return middleware;
}