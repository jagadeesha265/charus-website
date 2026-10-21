
const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const Admin = require("../models/Admin");

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Too many login attempts. Please try again later."
    }
});

// Admin login
router.post("/login", loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Please enter your username and password."
            });
        }

        const admin = await Admin.findOne({
            username: username.trim()
        });

        if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
            return res.status(401).json({
                message: "Invalid username or password."
            });
        }

        // Create a fresh session after successful login.
        req.session.regenerate((error) => {
            if (error) {
                console.error("Session creation failed:", error.message);

                return res.status(500).json({
                    message: "Could not create a login session."
                });
            }

            req.session.adminId = admin._id.toString();

            req.session.save((saveError) => {
                if (saveError) {
                    console.error("Session save failed:", saveError.message);

                    return res.status(500).json({
                        message: "Could not save the login session."
                    });
                }

                return res.status(200).json({
                    message: "Admin login successful."
                });
            });
        });
    } catch (error) {
        console.error("Admin login failed:", error.message);

        return res.status(500).json({
            message: "Login failed. Please try again."
        });
    }
});

// Check whether an admin is logged in.
router.get("/me", (req, res) => {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({
            authenticated: false,
            message: "Please log in."
        });
    }

    return res.status(200).json({
        authenticated: true
    });
});

// Admin logout
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.status(200).json({
            message: "Logged out successfully."
        });
    }

    req.session.destroy((error) => {
        if (error) {
            console.error("Logout failed:", error.message);

            return res.status(500).json({
                message: "Could not log out. Please try again."
            });
        }

        res.clearCookie("charus_admin_session", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
        });

        return res.status(200).json({
            message: "Logged out successfully."
        });
    });
});

module.exports = router;
