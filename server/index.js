
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const mongoose = require("mongoose");

const connectDB = require("./config/database");
const bookingRoutes = require("./routes/bookings");
const authRoutes = require("./routes/auth");
const siteImagesRoutes = require("./routes/siteImages");

const app = express();
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing.");
}

if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing.");
}

if (isProduction) {
    app.set("trust proxy", 1);
}

app.use(helmet({
    crossOriginResourcePolicy: {
        policy: "cross-origin"
    }
}));

app.use(cors({
    origin: isProduction
        ? process.env.FRONTEND_URL
        : [
            "http://localhost:5500",
            "http://127.0.0.1:5500"
        ],
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));

// Connect to MongoDB before handling API requests.
app.use(async (req, res, next) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            await connectDB();
        }
        next();
    } catch (error) {
        console.error("Database connection failed:", error.message);
        res.status(503).json({
            message: "Database is temporarily unavailable."
        });
    }
});

app.use(session({
    name: "charus_admin_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: "admin_sessions"
    }),
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 8
    }
}));

app.get("/", (req, res) => {
    res.json({
        message: "Charu's backend is running successfully!"
    });
});

app.use("/api/bookings", bookingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/site-images", siteImagesRoutes);

module.exports = app;
