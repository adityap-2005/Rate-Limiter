
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import redisClient from "../src/config/redis.js";
import { slidingWindowRateLimiter } from "../src/middlewares/slidingWindowRateLimiter.js";

describe("Sliding Window Rate Limiter", () => {
    beforeAll(async () => {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    });

    beforeEach(async () => {
        await redisClient.flushDb();
    });

    afterAll(async () => {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    });


    it("should allow requests below the limit", async () => {
        const app = express();

        const limiter = slidingWindowRateLimiter({
            limit: 3,
            windowMs: 10_000,
            keyPrefix: "sliding-allow-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        for (let i = 0; i < 3; i++) {
            const response = await request(app).get("/test");

            expect(response.status).toBe(200);
        }
    });

    it("should reject requests after reaching the limit", async () => {
        const app = express();

        const limiter = slidingWindowRateLimiter({
            limit: 3,
            windowMs: 10_000,
            keyPrefix: "sliding-reject-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        for (let i = 0; i < 3; i++) {
            const response = await request(app).get("/test");
            expect(response.status).toBe(200);
        }

        const response = await request(app).get("/test");

        expect(response.status).toBe(429);
        expect(response.body.error).toBe("Too many requests");
        expect(response.headers["retry-after"]).toMatch(/^\d+$/);
        expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    });


    it("should allow requests again after old requests leave the window", async () => {
        const app = express();

        const limiter = slidingWindowRateLimiter({
            limit: 2,
            windowMs: 1_000,
            keyPrefix: "sliding-expiry-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const first = await request(app).get("/test");
        const second = await request(app).get("/test");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const rejected = await request(app).get("/test");
        expect(rejected.status).toBe(429);

        // Wait for the previous requests to leave the sliding window.
        await new Promise((resolve) => setTimeout(resolve, 1_100));

        const afterWindow = await request(app).get("/test");
        expect(afterWindow.status).toBe(200);
    });

    it("should enforce the limit under concurrent requests", async () => {
        const app = express();

        const limiter = slidingWindowRateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "sliding-concurrent-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const responses = await Promise.all(
            Array.from(
                { length: 10 },
                () => request(app).get("/test")
            )
        );

        const successful = responses.filter((res) => res.status === 200);
        const rejected = responses.filter((res) => res.status === 429);

        expect(successful).toHaveLength(5);
        expect(rejected).toHaveLength(5);
    });


    it("should maintain independent limits for different client IPs", async () => {
        const app = express();

        app.set("trust proxy", true);

        app.use(
            slidingWindowRateLimiter({
                limit: 2,
                windowMs: 60_000,
                keyPrefix: "sliding-ip-test",
            })
        );

        app.get("/", (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const clientA = "203.0.113.10";
        const clientB = "203.0.113.20";

        const a1 = await request(app)
            .get("/")
            .set("X-Forwarded-For", clientA);

        const a2 = await request(app)
            .get("/")
            .set("X-Forwarded-For", clientA);

        const a3 = await request(app)
            .get("/")
            .set("X-Forwarded-For", clientA);

        const b1 = await request(app)
            .get("/")
            .set("X-Forwarded-For", clientB);

        expect(a1.status).toBe(200);
        expect(a2.status).toBe(200);
        expect(a3.status).toBe(429);
        expect(b1.status).toBe(200);
    });


    it("should reject invalid configuration", () => {
        expect(() =>
            slidingWindowRateLimiter({
                limit: 0,
                windowMs: 1_000,
                keyPrefix: "test",
            })
        ).toThrow("Invalid sliding window rate limiter configuration");

        expect(() =>
            slidingWindowRateLimiter({
                limit: 5,
                windowMs: -1,
                keyPrefix: "test",
            })
        ).toThrow("Invalid sliding window rate limiter configuration");

        expect(() =>
            slidingWindowRateLimiter({
                limit: 5,
                windowMs: 1_000,
                keyPrefix: "   ",
            })
        ).toThrow("Invalid sliding window rate limiter configuration");
    });


    it("should return 503 when Redis is unavailable", async () => {
        const app = express();

        const limiter = slidingWindowRateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "sliding-redis-failure-test",
        });

        app.get("/test", limiter, (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const evalSpy = vi
            .spyOn(redisClient, "eval")
            .mockRejectedValue(new Error("Simulated Redis failure"));

        try {
            const response = await request(app).get("/test");

            expect(response.status).toBe(503);
            expect(response.body.error).toBe("Service Unavailable");
        } finally {
            evalSpy.mockRestore();
        }
    });
});