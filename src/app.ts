import express from 'express';
const app = express();

import { rateLimiter } from './middlewares/rateLimiter.js';

app.use(express.json());

app.get("/api/test", rateLimiter, (req, res) => {
    res.status(200).json({
        message: "Request successful"
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        message: "Rate Limiter is running"
    })
});

export default app;