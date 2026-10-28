
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import redisClient from "../src/config/redis.js";
import { tokenBucketRateLimiter } from "../src/middlewares/tokenBucketRateLimiter.js";

describe("Token Bucket Rate Limiter", () => {
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


    it("should allow requests up to the bucket capacity and reject excess requests", async () => {
        const app = express();

        app.use(
            tokenBucketRateLimiter({
                capacity: 3,
                refillRate: 0.1,
                keyPrefix: "token-capacity-test",
            })
        );

        app.get("/", (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const first = await request(app).get("/");
        const second = await request(app).get("/");
        const third = await request(app).get("/");
        const fourth = await request(app).get("/");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(200);
        expect(fourth.status).toBe(429);
    });


    it("should allow requests again after tokens refill", async () => {
        const app = express();

        app.use(
            tokenBucketRateLimiter({
                capacity: 2,
                refillRate: 2,
                keyPrefix: "token-refill-test",
            })
        );

        app.get("/", (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const first = await request(app).get("/");
        const second = await request(app).get("/");
        const third = await request(app).get("/");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(429);

        await new Promise((resolve) => setTimeout(resolve, 600));

        const fourth = await request(app).get("/");

        expect(fourth.status).toBe(200);
    });


    it("should enforce the limit under concurrent requests", async () => {
        const app = express();

        app.use(
            tokenBucketRateLimiter({
                capacity: 5,
                refillRate: 0.01,
                keyPrefix: "token-concurrent-test",
            })
        );

        app.get("/", (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        const responses = await Promise.all(
            Array.from({ length: 10 }, () => request(app).get("/"))
        );

        const successful = responses.filter((response) => response.status === 200);
        const rejected = responses.filter((response) => response.status === 429);

        expect(successful).toHaveLength(5);
        expect(rejected).toHaveLength(5);
    });


    it("should preserve fractional tokens between requests", async () => {
        const app = express();

        app.use(
            tokenBucketRateLimiter({
                capacity: 2,
                refillRate: 2,
                keyPrefix: "token-fractional-test",
            })
        );

        app.get("/", (_req, res) => {
            res.status(200).json({ message: "Success" });
        });

        expect((await request(app).get("/")).status).toBe(200);
        expect((await request(app).get("/")).status).toBe(200);

        // The bucket is empty.
        expect((await request(app).get("/")).status).toBe(429);

        // Refill approximately 0.5 tokens.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect((await request(app).get("/")).status).toBe(429);

        // Total elapsed time is now approximately 550 ms,
        // enough to refill approximately 1.1 tokens.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect((await request(app).get("/")).status).toBe(200);
    });
});
