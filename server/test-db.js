
require("dotenv").config();

const connectDB = require("./config/database");

connectDB()
    .then(async () => {
        const mongoose = require("mongoose");
        await mongoose.disconnect();
        console.log("✅ Connection test completed.");
        process.exit(0);
    })
    .catch(() => {
        process.exit(1);
    });
