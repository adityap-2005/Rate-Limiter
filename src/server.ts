import dotenv from'dotenv';
import app from './app.js';
import redisClient from './config/redis.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function startServer () {
    try{
        await redisClient.connect();
        console.log("Redis connected successfully");

        app.listen(PORT, ()=>{
            console.log(`Server running on port ${PORT}`);
        });
    } catch(error){
        console.log("Failed to start server:", error);
        process.exit(1);
    }
}

startServer();