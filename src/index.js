// src/index.js
import "dotenv/config";          // Load .env if present (see also --env-file in npm scripts)

import crypto from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";

// Configuration gate (F-08, F-69): this module validates the environment on
// import, and as the first import here it evaluates before MongoDB, Firebase
// or the route graph can connect. Production refuses to boot when required
// configuration is missing.
import { isProduction } from "./config/validateEnv.js";
import { buildCorsOptions } from "./config/cors.js";
import { pingCloudinary, resolveCloudinaryConfig } from "./utils/mediaHandler.js";
import { globalApiLimiter } from "./middleware/rateLimiters.js";
import { logger, requestContext } from "./utils/logger.js";

// Open external connections after validation (F-69, F-28).
await import("./config/mongo.js").then(({ connectDatabase, resolveMongoUri }) => (
    connectDatabase(resolveMongoUri())
));
await import("./config/firebase.js");

// Routes
import contractRoutes from "./routes/contractRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import mongoose from "mongoose";


const app = express();

app.disable("x-powered-by");
app.use(helmet());

// Behind Leapcell/Render the client IP arrives via X-Forwarded-For; trusting the
// proxy hop keeps per-IP rate limiting correct (F-02).
app.set("trust proxy", 1);

// Request IDs for structured logging and support triage (F-47).
app.use((req, res, next) => {
    req.rid = crypto.randomBytes(6).toString("hex");
    res.setHeader("X-Request-Id", req.rid);
    res.on("finish", () => {
        logger.info("request", requestContext(req));
    });
    next();
});

// Per-IP ceiling before bodies are parsed, so floods are refused cheaply.
app.use(globalApiLimiter);

// Middleware
app.use(cors(buildCorsOptions({
    corsOrigins: process.env.CORS_ORIGINS,
    production: isProduction(),
})));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Test endpoint
app.get("/", (req, res) => {
    res.json({ message: "YACK backend is running" });
});

// Liveness: the process is up. (F-15)
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

// Readiness: dependencies are actually ready, not just the process.
app.get("/health/ready", (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({
        status: dbReady ? "ready" : "unavailable",
        database: dbReady ? "connected" : mongoose.connection.readyState,
    });
});

// API routes
app.use("/contracts", contractRoutes);
app.use("/messages", messageRoutes);
app.use("/media", mediaRoutes);
app.use("/user", userRoutes);
app.use("/support", supportRoutes);
app.use("/admin", adminRoutes);

// Global error handler
app.use((err, req, res, next) => {
    logger.error("Server Error:", requestContext(req), { error: err?.message });
    res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || (isProduction() ? 80 : 3000);
const server = app.listen(PORT, () => {
    logger.info(`YACK backend running on port ${PORT}`, { production: isProduction() });
});

// Abandoned-connection guards (F-15): slowloris-style connections are torn
// down instead of accumulating.
server.requestTimeout = 60 * 1000;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 5 * 1000;
app.use((req, res, next) => {
    req.setTimeout(30 * 1000, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: "Request timed out" });
            res.end();
        }
    });
    next();
});

// Graceful shutdown (F-15): stop accepting connections, finish in-flight work
// (bounded by Node's default server close), then close the database cleanly
// so a restart does not leave the platform fighting zombie sockets.
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down gracefully`);
    server.close(async () => {
        try {
            await mongoose.disconnect();
            logger.info("Shutdown complete");
            process.exit(0);
        } catch (error) {
            logger.error("Shutdown error:", { error: error.message });
            process.exit(1);
        }
    });
    // Hard stop if in-flight work never drains.
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", { error: String(reason) });
});
process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", { error: error.message, stack: error.stack });
});

// Boot-time Cloudinary connectivity check (F-69): credentials are verified
// now rather than failing lazily on the first media upload. Failures are
// surfaced but do not abort boot, so a transient provider outage is not
// amplified into a full outage.
if (resolveCloudinaryConfig()) {
    pingCloudinary()
        .then(() => logger.info("[Cloudinary] Connected"))
        .catch((error) => logger.error("[Cloudinary] Connectivity check failed:", { error: error.message }));
}