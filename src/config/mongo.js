// src/config/mongo.js
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/yack";

mongoose.connect(MONGO_URI, {
    dbName: "yack",
})
    .then(() => console.log("MongoDB Connected"))
    .catch((err) => {
        console.error("MongoDB Connection Error:", err.message);
        process.exit(1);
    });

export default mongoose;
