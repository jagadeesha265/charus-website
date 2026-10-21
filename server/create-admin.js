
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("./config/database");
const Admin = require("./models/Admin");

async function createAdmin() {
    try {
        await connectDB();

        const username = process.env.ADMIN_USERNAME;
        const password = process.env.ADMIN_PASSWORD;

        if (!username || !password) {
            throw new Error(
                "Please set ADMIN_USERNAME and ADMIN_PASSWORD in server/.env"
            );
        }

        const existingAdmin = await Admin.findOne({ username });

        if (existingAdmin) {
            console.log("An admin with this username already exists.");
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await Admin.create({
            username,
            passwordHash
        });

        console.log("✅ Admin account created successfully!");
        console.log(`Username: ${username}`);
        console.log("Password: configured securely (not displayed).");
    } catch (error) {
        console.error("❌ Admin setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

createAdmin();
