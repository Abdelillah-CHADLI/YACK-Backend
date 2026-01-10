// src/index.js
import express from "express";
import cors from "cors";
import "./config/mongo.js";           // Connect to MongoDB
import admin from "./config/firebase.js"; // Ensure Firebase is initialized

// Routes
import contractRoutes from "./routes/contractRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";
import userRoutes from "./routes/userRoutes.js";


const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Test endpoint
app.get("/", (req, res) => {
    res.json({ message: "YACK backend is running" });
});

// API routes
app.use("/contracts", contractRoutes);
app.use("/messages", messageRoutes);
app.use("/media", mediaRoutes);
app.use("/user", userRoutes);

// Global error handler
app.use((err, req, res, next) => {
    console.error("Server Error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
});

// Start server
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
    console.log(`YACK backend running on port ${PORT}`);
});
