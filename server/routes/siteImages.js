
const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const multer = require("multer");
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;

const router = express.Router();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

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

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({
            message: "Please log in as admin."
        });
    }

    next();
}

function getBucket() {
    if (!mongoose.connection.db) {
        throw new Error("Database is not connected.");
    }

    return new GridFSBucket(mongoose.connection.db, {
        bucketName: "siteImages"
    });
}

function getCloudImageCollection() {
    if (!mongoose.connection.db) {
        throw new Error("Database is not connected.");
    }

    return mongoose.connection.db.collection("siteImageRecords");
}

function formatGridFSImage(file) {
    return {
        _id: file._id.toString(),
        filename: file.filename,
        category: file.metadata?.category || "gallery",
        contentType: file.metadata?.contentType || "image/jpeg",
        uploadedAt: file.uploadDate
    };
}

function formatCloudImage(file) {
    return {
        _id: file._id.toString(),
        filename: file.filename,
        category: file.category || "gallery",
        contentType: file.contentType || "image/jpeg",
        uploadedAt: file.uploadedAt,
        storage: "cloudinary"
    };
}

function uploadToCloudinary(file, category) {
    return new Promise((resolve, reject) => {
        const safeName = file.originalname
            .replace(/\.[^.]+$/, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(-80) || "image";

        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "charus-website",
                resource_type: "image",
                format: undefined,
                public_id: `${Date.now()}-${Math.random()
                    .toString(36).slice(2, 10)}-${safeName}`,
                context: {
                    category
                }
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                resolve(result);
            }
        );

        Readable.from([file.buffer]).pipe(stream);
    });
}

async function listImages() {
    const bucket = getBucket();
    const cloudCollection = getCloudImageCollection();

    const [gridFiles, cloudFiles] = await Promise.all([
        bucket.find({}).toArray(),
        cloudCollection.find({}).toArray()
    ]);

    return [
        ...gridFiles.map(formatGridFSImage),
        ...cloudFiles.map(formatCloudImage)
    ].sort((a, b) =>
        new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)
    );
}

// ADMIN: List uploaded images.
router.get("/", requireAdmin, async (req, res, next) => {
    try {
        res.json({
            images: await listImages()
        });
    } catch (error) {
        next(error);
    }
});

// PUBLIC: List images for the website.
router.get("/public", async (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");

        res.json({
            images: await listImages()
        });
    } catch (error) {
        next(error);
    }
});

// ADMIN: Upload images to My Works or Gallery using Cloudinary.
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

        const collection = getCloudImageCollection();
        const uploadedAssets = [];
        const savedIds = [];

        try {
            for (const file of req.files) {
                const result = await uploadToCloudinary(file, category);

                uploadedAssets.push(result.public_id);

                const document = {
                    filename: file.originalname
                        .replace(/[^a-zA-Z0-9._-]/g, "_")
                        .slice(-100),
                    category,
                    contentType: file.mimetype,
                    uploadedAt: new Date(),
                    storage: "cloudinary",
                    publicId: result.public_id,
                    secureUrl: result.secure_url
                };

                const insertResult = await collection.insertOne(document);
                savedIds.push(insertResult.insertedId);
            }

            res.status(201).json({
                message: `${savedIds.length} image(s) uploaded successfully.`,
                uploadedCount: savedIds.length
            });
        } catch (error) {
            // Remove records and Cloudinary assets created by this request
            // if any part of the upload fails.
            await Promise.all(
                savedIds.map(async id => {
                    try {
                        await collection.deleteOne({ _id: id });
                    } catch (_) {}
                })
            );

            await Promise.all(
                uploadedAssets.map(async publicId => {
                    try {
                        await cloudinary.uploader.destroy(publicId);
                    } catch (_) {}
                })
            );

            next(error);
        }
    }
);

// PUBLIC: Display an image by its ID.
// Cloudinary images redirect to their secure URL.
// Older GridFS images continue to stream from MongoDB.
router.get("/image/:id", async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                message: "Invalid image ID."
            });
        }

        const id = new mongoose.Types.ObjectId(req.params.id);
        const collection = getCloudImageCollection();

        const cloudImage = await collection.findOne({ _id: id });

        if (cloudImage) {
            if (!cloudImage.secureUrl) {
                return res.status(404).json({
                    message: "Image URL not found."
                });
            }

            return res.redirect(302, cloudImage.secureUrl);
        }

        const bucket = getBucket();
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

// ADMIN: Delete either a Cloudinary image or an older GridFS image.
router.delete("/:id", requireAdmin, async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                message: "Invalid image ID."
            });
        }

        const id = new mongoose.Types.ObjectId(req.params.id);
        const collection = getCloudImageCollection();
        const cloudImage = await collection.findOne({ _id: id });

        if (cloudImage) {
            await cloudinary.uploader.destroy(cloudImage.publicId);

            await collection.deleteOne({ _id: id });

            return res.json({
                message: "Image deleted successfully."
            });
        }

        const bucket = getBucket();
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
