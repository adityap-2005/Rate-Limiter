import express from 'express';
const app = express();

import { rateLimiter } from './middlewares/rateLimiter.js';

app.use(express.json());

const testRateLimiter = rateLimiter({
    limit: 5,
    windowMs: 60_000,
});

const searchRateLimiter = rateLimiter({
    limit: 20,
    windowMs: 60_000,
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

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        message: "Rate Limiter is running"
    });
});

export default app;