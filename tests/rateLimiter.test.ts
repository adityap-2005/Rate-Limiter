import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { rateLimiter } from "../src/middlewares/rateLimiter.js";

describe("Rate Limiter", () => {
    it("should allow a request below the limit", async () => {
        const app = express();
        const limiter = rateLimiter({
            limit: 5,
            windowMs: 60_000,
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
            rateLimiter({ limit: 0, windowMs: 60_000 })
        ).toThrow("Invalid rate limiter configuration");

        expect(() =>
            rateLimiter({ limit: 5, windowMs: 0 })
        ).toThrow("Invalid rate limiter configuration");
    });

    it("should allow requests again after the window expires", async () => {
        vi.useFakeTimers();

        try {
            const app = express();

            const limiter = rateLimiter({
                limit: 2,
                windowMs: 1_000,
            });

            app.get("/test", limiter, (req, res) => {
                res.status(200).json({ message: "Success" });
            });

            const first = await request(app).get("/test");
            const second = await request(app).get("/test");

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);

            const blocked = await request(app).get("/test");
            expect(blocked.status).toBe(429);

            vi.advanceTimersByTime(1_001);

            const afterExpiry = await request(app).get("/test");
            expect(afterExpiry.status).toBe(200);
            expect(afterExpiry.headers["x-ratelimit-remaining"]).toBe("1");
        } finally {
            vi.useRealTimers();
        }
    });
});