import express from 'express';
const app = express();

import { rateLimiter } from './middlewares/rateLimiter.js';
import { slidingWindowRateLimiter } from './middlewares/slidingWindowRateLimiter.js';
import { tokenBucketRateLimiter } from './middlewares/tokenBucketRateLimiter.js';

app.use(express.json());

const testRateLimiter = rateLimiter({
    limit: 5,
    windowMs: 60_000,
    keyPrefix : "test"
});

const searchRateLimiter = rateLimiter({
    limit: 20,
    windowMs: 60_000,
    keyPrefix : "search"
});

const slidingWindowTestRateLimiter = slidingWindowRateLimiter({
    limit: 5,
    windowMs: 60_000,
    keyPrefix: "sliding-test"
});

const tokenBucketTestRateLimiter = tokenBucketRateLimiter({
    capacity: 5,
    refillRate: 0.1,
    keyPrefix: "token-bucket-test"
});

app.get("/api/test", testRateLimiter, (req, res) => {
    res.status(200).json({
        message: "Request successful"
    });
});

app.get("/api/search", searchRateLimiter, (req, res) => {
    res.status(200).json({
        message: "Request successful"
    });
});

app.get("/api/sliding-test", slidingWindowTestRateLimiter, (req, res) => {
    res.status(200).json({
        message: "Sliding Window request successful"
    });
});

app.get("/api/token-bucket", tokenBucketTestRateLimiter, (req, res) => {
    res.status(200).json({
        message: "Token Bucket request successful"
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        message: "Rate Limiter is running"
    });
});

export default app;