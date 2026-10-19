import { createClient } from "redis";

const redisClient = createClient({
    url : "redis://localhost:6379",
});

redisClient.on("error",(err)=>{
    console.error("Redis CLient Error:", err);
});

export default redisClient;