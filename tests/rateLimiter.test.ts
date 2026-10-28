import {
    describe,
    it,
    expect,
    beforeAll,
    beforeEach,
    afterAll,
    vi
} from "vitest";
import express from "express";
import request from "supertest";
import { rateLimiter } from "../src/middlewares/rateLimiter.js";
import redisClient from "../src/config/redis.js";

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

describe("Rate Limiter", () => {
    it("should allow a request below the limit", async () => {
        const app = express();
        const limiter = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "test"
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const response = await request(app).get("/test");

        expect(response.status).toBe(200);
        expect(response.headers["x-ratelimit-limit"]).toBe("5");
        expect(response.headers["x-ratelimit-remaining"]).toBe("4");
    });

    it("should reject requests after reaching the limit", async () => {
        const app = express();

        const limiter = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "test"
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({
                message: "Success"
            })
        });

        for (let i = 0; i < 5; i++) {
            const response = await request(app).get("/test");
            expect(response.status).toBe(200);
        }

        const blockedResponse = await request(app).get("/test");

        expect(blockedResponse.status).toBe(429);
        expect(blockedResponse.headers["x-ratelimit-remaining"]).toBe("0");
    });

    it("should reject an invalid configuration", () => {
        expect(() =>
            rateLimiter({ limit: 0, windowMs: 60_000, keyPrefix: "test" })
        ).toThrow("Invalid rate limiter configuration");

        expect(() =>
            rateLimiter({ limit: 5, windowMs: 0, keyPrefix: "test" })
        ).toThrow("Invalid rate limiter configuration");
        expect(() =>
            rateLimiter({ limit: -1, windowMs: 60_000, keyPrefix: "test" })
        ).toThrow("Invalid rate limiter configuration");

        expect(() =>
            rateLimiter({ limit: 5, windowMs: -1, keyPrefix: "test" })
        ).toThrow("Invalid rate limiter configuration");

        expect(() =>
            rateLimiter({ limit: 5, windowMs: 60_000, keyPrefix: "   " })
        ).toThrow("Invalid rate limiter configuration");
    });

    it("should enforce the limit under concurrent requests", async () => {
        const app = express();

        const limiter = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "concurrent-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const responses = await Promise.all(
            Array.from({ length: 10 }, () =>
                request(app).get("/test")
            )
        );

        const successful = responses.filter(
            (response) => response.status === 200
        );

        const rejected = responses.filter(
            (response) => response.status === 429
        );

        expect(successful).toHaveLength(5);
        expect(rejected).toHaveLength(5);
    });

    it("should return 503 when Redis is unavailable", async () => {
        const app = express();

        const limiter = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "redis-failure-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const evalSpy = vi
            .spyOn(redisClient, "eval")
            .mockRejectedValue(new Error("Simulated Redis failure"));

        try {
            const response = await request(app).get("/test");

            expect(response.status).toBe(503);
            expect(response.body.error).toBe("Service unavailable");
        } finally {
            evalSpy.mockRestore();
        }
    });

    it("should share rate limits across separate app instances", async () => {
        const appA = express();
        const appB = express();

        const limiterA = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "shared-instance-test",
        });

        const limiterB = rateLimiter({
            limit: 5,
            windowMs: 60_000,
            keyPrefix: "shared-instance-test",
        });

        appA.get("/test", limiterA, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        appB.get("/test", limiterB, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const responses = [];

        for (let i = 0; i < 3; i++) {
            responses.push(await request(appA).get("/test"));
        }

        for (let i = 0; i < 3; i++) {
            responses.push(await request(appB).get("/test"));
        }

        const successful = responses.filter((res) => res.status === 200);
        const rejected = responses.filter((res) => res.status === 429);

        expect(successful).toHaveLength(5);
        expect(rejected).toHaveLength(1);
    });


    it("should allow requests again after the window expires", async () => {
        const app = express();

        const limiter = rateLimiter({
            limit: 1,
            windowMs: 200,
            keyPrefix: "expiration-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const first = await request(app).get("/test");
        const blocked = await request(app).get("/test");

        expect(first.status).toBe(200);
        expect(blocked.status).toBe(429);

        await new Promise((resolve) => setTimeout(resolve, 300));

        const afterExpiry = await request(app).get("/test");

        expect(afterExpiry.status).toBe(200);
    });


    it("should apply independent rate limits to different client IPs", async () => {
        const app = express();
        app.set("trust proxy", true);

        const limiter = rateLimiter({
            limit: 1,
            windowMs: 60_000,
            keyPrefix: "ip-isolation-test",
        });

        app.get("/test", limiter, (req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const clientAFirst = await request(app)
            .get("/test")
            .set("X-Forwarded-For", "203.0.113.10");

        const clientASecond = await request(app)
            .get("/test")
            .set("X-Forwarded-For", "203.0.113.10");

        const clientBFirst = await request(app)
            .get("/test")
            .set("X-Forwarded-For", "203.0.113.20");

        expect(clientAFirst.status).toBe(200);
        expect(clientASecond.status).toBe(429);
        expect(clientBFirst.status).toBe(200);
    });
});