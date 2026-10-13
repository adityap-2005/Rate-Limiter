import type { Request, Response, NextFunction } from "express";

const LIMIT = 5;
const WINDOW_MS = 60 * 1000;

interface ClientRecord {
    count: number,
    windowStart: number
}

const clients = new Map<string, ClientRecord>();

function cleanupExpiredRecords() {
    const now = Date.now();

    console.log("Running rate limiter cleanup");
    for (const [ip, record] of clients) {
        const expired = now - record.windowStart >= WINDOW_MS;

        if (expired) {
            clients.delete(ip);
            console.log(`Removed expired record for ${ip}`)
        }
    }
}

setInterval(cleanupExpiredRecords, 30 * 1000);


export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-RateLimit-Limit", LIMIT);
    
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const record = clients.get(ip);
    

    if (!record || now - record.windowStart >= WINDOW_MS) {
        clients.set(ip, {
            count: 1,
            windowStart: now
        });

        res.setHeader("X-RateLimit-Remaining", LIMIT - 1);

        return next();
    }

    if (record.count >= LIMIT) {
        res.setHeader("X-RateLimit-Remaining", 0);

        return res.status(429).json({
            error: "Too many requests",
            message: "Rate limit exceeded. Try again later."
        })
    }

    record.count++;
    res.setHeader("X-RateLimit-Remaining", LIMIT - record.count);
    return next();
}