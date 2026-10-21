
const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const multer = require("multer");
const { Readable } = require("stream");
const Booking = require("../models/Booking");

const router = express.Router();

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_SERVICES = [
    "Saree Pleating",
    "Box Folding",
    "Mehndi Design",
    "Bridal Mehndi"
];
const ALLOWED_STATUSES = ["Confirmed", "Cancelled"];
const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({
            message: "Admin login required."
        });
    }
    next();
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1
    },
    fileFilter: (req, file, callback) => {
        if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
            return callback(
                new Error("Only JPG, PNG, and WebP images are allowed.")
            );
        }
        callback(null, true);
    }
});

function getImageBucket() {
    if (!mongoose.connection.db) {
        throw new Error("Database is not connected.");
    }

    return new GridFSBucket(mongoose.connection.db, {
        bucketName: "referenceImages"
    });
}

function saveImage(file) {
    return new Promise((resolve, reject) => {
        const bucket = getImageBucket();
        const filename =
            `${Date.now()}-${new mongoose.Types.ObjectId()}`;

        const stream = bucket.openUploadStream(filename, {
            contentType: file.mimetype,
            metadata: {
                contentType: file.mimetype,
                originalName: file.originalname
            }
        });

        stream.on("error", reject);
        stream.on("finish", () => resolve(stream.id));

        Readable.from(file.buffer).pipe(stream);
    });
}

async function deleteImage(imageId) {
    if (!imageId) return;

    try {
        await getImageBucket().delete(imageId);
    } catch (error) {
        console.error("Could not remove unused image:", error.message);
    }
}

// Create a booking with an optional reference image.
router.post("/", (req, res, next) => {
    upload.single("referenceImage")(req, res, (error) => {
        if (error) {
            const message =
                error.code === "LIMIT_FILE_SIZE"
                    ? "Image must be 5 MB or smaller."
                    : error.message;

            return res.status(400).json({ message });
        }
        next();
    });
}, async (req, res) => {
    let imageId = null;

    try {
        const {
            customerName,
            phone,
            service,
            bookingDate,
            bookingTime,
            quantity,
            message
        } = req.body;

        if (
            typeof customerName !== "string" ||
            !customerName.trim() ||
            typeof phone !== "string" ||
            !/^[0-9]{10}$/.test(phone.trim()) ||
            !ALLOWED_SERVICES.includes(service) ||
            typeof bookingDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
            typeof bookingTime !== "string" ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(bookingTime) ||
            !Number.isInteger(Number(quantity)) ||
            Number(quantity) < 1 ||
            (message !== undefined && typeof message !== "string") ||
            (typeof message === "string" && message.length > 1000)
        ) {
            return res.status(400).json({
                message: "Please provide valid booking details."
            });
        }

        const [year, month, day] = bookingDate.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));

        const validDate =
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;

        const now = new Date();
        const todayString = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-");

        if (!validDate || bookingDate < todayString) {
            return res.status(400).json({
                message: "Please choose a valid date that is not in the past."
            });
        }

        if (bookingDate === todayString) {
            const [hours, minutes] = bookingTime.split(":").map(Number);

            if (
                hours * 60 + minutes <=
                now.getHours() * 60 + now.getMinutes()
            ) {
                return res.status(400).json({
                    message: "Please choose a future time."
                });
            }
        }

        if (req.file) {
            imageId = await saveImage(req.file);
        }

        const booking = await Booking.create({
            customerName: customerName.trim(),
            phone: phone.trim(),
            service,
            bookingDate,
            bookingTime,
            quantity: Number(quantity),
            message: (message || "").trim(),
            referenceImageId: imageId
        });

        return res.status(201).json({
            message: "Booking saved successfully!",
            booking: {
                id: booking._id,
                customerName: booking.customerName,
                service: booking.service,
                bookingDate: booking.bookingDate,
                bookingTime: booking.bookingTime,
                quantity: booking.quantity,
                status: booking.status,
                hasReferenceImage: Boolean(booking.referenceImageId)
            }
        });
    } catch (error) {
        // Avoid leaving an image unlinked if booking creation fails.
        await deleteImage(imageId);

        if (error.code === 11000) {
            return res.status(409).json({
                message: "This time slot is already booked. Please choose another time."
            });
        }

        console.error("Booking creation failed:", error.message);

        return res.status(500).json({
            message: "Could not create the booking. Please try again."
        });
    }
});

// Admin: view all bookings.
router.get("/admin/all", requireAdmin, async (req, res) => {
    try {
        const bookings = await Booking.find()
            .sort({ createdAt: -1 })
            .select("-__v")
            .lean();

        return res.status(200).json({ bookings });
    } catch (error) {
        console.error("Could not fetch bookings:", error.message);
        return res.status(500).json({
            message: "Could not load bookings."
        });
    }
});

// Admin: view a booking's reference image.
router.get("/admin/:id/reference-image", requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (!/^[a-f\d]{24}$/i.test(id)) {
            return res.status(400).json({
                message: "Invalid booking ID."
            });
        }

        const booking = await Booking.findById(id).lean();

        if (!booking) {
            return res.status(404).json({
                message: "Booking not found."
            });
        }

        if (!booking.referenceImageId) {
            return res.status(404).json({
                message: "This booking has no reference image."
            });
        }

        const bucket = getImageBucket();
        const files = await bucket.find({
            _id: booking.referenceImageId
        }).toArray();

        if (!files.length) {
            return res.status(404).json({
                message: "Reference image not found."
            });
        }

        const file = files[0];
        const contentType = file.metadata?.contentType;

        if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
            return res.status(415).json({
                message: "Unsupported image type."
            });
        }

        res.set("Content-Type", contentType);
        res.set("Content-Disposition", "inline");
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Cache-Control", "private, no-store");

        const downloadStream = bucket.openDownloadStream(
            booking.referenceImageId
        );

        downloadStream.on("error", (error) => {
            console.error("Image download failed:", error.message);
            if (!res.headersSent) {
                res.status(404).end("Reference image not found.");
            } else {
                res.destroy(error);
            }
        });

        downloadStream.pipe(res);
    } catch (error) {
        console.error("Could not load reference image:", error.message);

        if (!res.headersSent) {
            res.status(500).json({
                message: "Could not load reference image."
            });
        }
    }
});

// Admin: update booking status.
router.patch("/admin/:id/status", requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!/^[a-f\d]{24}$/i.test(id)) {
            return res.status(400).json({
                message: "Invalid booking ID."
            });
        }

        if (!ALLOWED_STATUSES.includes(status)) {
            return res.status(400).json({
                message: "Invalid booking status."
            });
        }

        const booking = await Booking.findById(id);

        if (!booking) {
            return res.status(404).json({
                message: "Booking not found."
            });
        }

        if (booking.status === "Completed") {
            return res.status(409).json({
                message: "Completed bookings cannot be changed."
            });
        }

        if (booking.status === "Cancelled" && status === "Confirmed") {
            return res.status(409).json({
                message: "Cancelled bookings cannot be confirmed."
            });
        }

        if (!Number.isInteger(booking.quantity) || booking.quantity < 1) {
            booking.quantity = 1;
        }

        booking.status = status;
        await booking.save();

        return res.status(200).json({
            message: `Booking ${status.toLowerCase()} successfully.`,
            booking: {
                id: booking._id,
                status: booking.status
            }
        });
    } catch (error) {
        console.error("Booking status update failed:", error.message);
        return res.status(500).json({
            message: "Could not update booking status."
        });
    }
});

module.exports = router;
