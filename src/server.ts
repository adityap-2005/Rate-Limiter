
import dotenv from 'dotenv';
import app from './app.js';
import redisClient from './config/redis.js';
import type { Server } from 'node:http';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

let server: Server | undefined;
let isShuttingDown = false;

async function startServer() {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully');

        server = app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);

        if (redisClient.isOpen) {
            await redisClient.quit();
        }

        process.exitCode = 1;
    }
}

async function shutdown(signal: string) {
    if (isShuttingDown) return;

    isShuttingDown = true;
    console.log(`${signal} received. Shutting down gracefully...`);

    try {
        if (server) {
            await new Promise<void>((resolve, reject) => {
                server!.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }

        if (redisClient.isOpen) {
            await redisClient.quit();
        }

        console.log('Shutdown complete');
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exitCode = 1;
    }
}

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

startServer();
