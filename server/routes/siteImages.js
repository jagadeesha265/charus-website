
const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const multer = require("multer");
const { Readable } = require("stream");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, callback) => {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return callback(
                new Error("Only JPG, PNG and WebP images are allowed.")
            );
        }

        callback(null, true);
    }
});

// Check whether the user is logged in as admin.
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({
            message: "Please log in as admin."
        });
    }

    next();
}

// Connect to the GridFS image storage.
function getBucket() {
    if (!mongoose.connection.db) {
        throw new Error("Database is not connected.");
    }

    return new GridFSBucket(mongoose.connection.db, {
        bucketName: "siteImages"
    });
}

// Convert database image records into safe response objects.
function formatImage(file) {
    return {
        _id: file._id.toString(),
        filename: file.filename,
        category: file.metadata?.category || "gallery",
        contentType: file.metadata?.contentType || "image/jpeg",
        uploadedAt: file.uploadDate
    };
}

// 1. ADMIN: List all uploaded images.
router.get("/", requireAdmin, async (req, res, next) => {
    try {
        const bucket = getBucket();
        const files = await bucket.find({}).toArray();

        res.json({
            images: files.map(formatImage)
        });
    } catch (error) {
        next(error);
    }
});

// 2. PUBLIC: List images for the public website.
// No admin login is required for this endpoint.
router.get("/public", async (req, res, next) => {
    try {
        const bucket = getBucket();
        const files = await bucket.find({}).toArray();

        res.set("Cache-Control", "no-store");

        res.json({
            images: files.map(formatImage)
        });
    } catch (error) {
        next(error);
    }
});

// 3. ADMIN: Upload images to My Works or Gallery.
router.post(
    "/upload",
    requireAdmin,
    upload.array("images", 10),
    async (req, res, next) => {
        const category = req.body.category;

        if (!["works", "gallery"].includes(category)) {
            return res.status(400).json({
                message: "Choose My Works or Gallery."
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                message: "Please select at least one image."
            });
        }

        const bucket = getBucket();
        const uploadedIds = [];

        try {
            for (const file of req.files) {
                const safeName = file.originalname
                    .replace(/[^a-zA-Z0-9._-]/g, "_")
                    .slice(-100);

                const stream = bucket.openUploadStream(safeName, {
                    metadata: {
                        category,
                        contentType: file.mimetype
                    }
                });

                await new Promise((resolve, reject) => {
                    stream.once("error", reject);

                    stream.once("finish", () => {
                        uploadedIds.push(stream.id);
                        resolve();
                    });

                    Readable.from(file.buffer).pipe(stream);
                });
            }

            res.status(201).json({
                message: `${uploadedIds.length} image(s) uploaded successfully.`,
                uploadedCount: uploadedIds.length
            });
        } catch (error) {
            // Clean up files uploaded by this request if it fails.
            await Promise.all(
                uploadedIds.map(async id => {
                    try {
                        await bucket.delete(id);
                    } catch (_) {
                        // Ignore cleanup errors.
                    }
                })
            );

            next(error);
        }
    }
);

// 4. PUBLIC: Display an image using its ID.
router.get("/image/:id", async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                message: "Invalid image ID."
            });
        }

        const bucket = getBucket();
        const id = new mongoose.Types.ObjectId(req.params.id);
        const files = await bucket.find({ _id: id }).toArray();

        if (!files.length) {
            return res.status(404).json({
                message: "Image not found."
            });
        }

        const file = files[0];

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        const contentType = file.metadata?.contentType;

        if (!allowedTypes.includes(contentType)) {
            return res.status(415).json({
                message: "Unsupported image type."
            });
        }

        res.set("Content-Type", contentType);
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Cache-Control", "public, max-age=300");

        const downloadStream = bucket.openDownloadStream(id);

        downloadStream.on("error", error => {
            if (!res.headersSent) {
                next(error);
            } else {
                res.destroy(error);
            }
        });

        downloadStream.pipe(res);
    } catch (error) {
        next(error);
    }
});

// 5. ADMIN: Delete an uploaded image.
router.delete("/:id", requireAdmin, async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                message: "Invalid image ID."
            });
        }

        const bucket = getBucket();
        const id = new mongoose.Types.ObjectId(req.params.id);
        const files = await bucket.find({ _id: id }).toArray();

        if (!files.length) {
            return res.status(404).json({
                message: "Image not found."
            });
        }

        await bucket.delete(id);

        res.json({
            message: "Image deleted successfully."
        });
    } catch (error) {
        next(error);
    }
});

// Handle upload and image errors.
router.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof multer.MulterError) {
        let message = error.message;

        if (error.code === "LIMIT_FILE_SIZE") {
            message = "Each image must be 5 MB or smaller.";
        } else if (error.code === "LIMIT_FILE_COUNT") {
            message = "You can upload up to 10 images at once.";
        }

        return res.status(400).json({ message });
    }

    if (error.message?.includes("Only JPG")) {
        return res.status(400).json({
            message: error.message
        });
    }

    console.error("Site image error:", error);

    res.status(500).json({
        message: "Could not process the image request."
    });
});

module.exports = router;
