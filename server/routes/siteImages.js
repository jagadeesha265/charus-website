
const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const multer = require("multer");
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;

const router = express.Router();

// ================= CLOUDINARY CONFIGURATION =================

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

if (!cloudName || !apiKey || !apiSecret) {
    console.error(
        "Cloudinary configuration is missing required environment variables."
    );
}

cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
});

// ================= IMAGE UPLOAD CONFIGURATION =================

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

// ================= ADMIN AUTHENTICATION =================

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({
            message: "Please log in as admin."
        });
    }

    next();
}

// ================= DATABASE HELPERS =================

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

// ================= IMAGE FORMATTING =================

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

// ================= CLOUDINARY UPLOAD =================

function uploadToCloudinary(file, category) {
    return new Promise((resolve, reject) => {
        const safeName = file.originalname
            .replace(/\.[^.]+$/, "")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(-80) || "image";

        const publicId =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}-${safeName}`;

        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "charus-website",
                resource_type: "image",
                public_id: publicId,
                context: {
                    category
                }
            },
            (error, result) => {
                if (error) {
                    console.error("Cloudinary upload failed:", {
                        message: error.message,
                        http_code: error.http_code,
                        name: error.name
                    });

                    return reject(error);
                }

                if (!result || !result.secure_url || !result.public_id) {
                    return reject(
                        new Error("Cloudinary returned an incomplete upload result.")
                    );
                }

                resolve(result);
            }
        );

        Readable.from([file.buffer]).pipe(stream);
    });
}

// ================= LIST ALL IMAGES =================

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
        new Date(b.uploadedAt || 0) -
        new Date(a.uploadedAt || 0)
    );
}

// ================= ADMIN: LIST IMAGES =================

router.get("/", requireAdmin, async (req, res, next) => {
    try {
        res.json({
            images: await listImages()
        });
    } catch (error) {
        next(error);
    }
});

// ================= PUBLIC: LIST IMAGES =================

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

// ================= ADMIN: UPLOAD IMAGES =================

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

        let collection;

        try {
            collection = getCloudImageCollection();
        } catch (error) {
            return next(error);
        }

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

            return res.status(201).json({
                message: `${savedIds.length} image(s) uploaded successfully.`,
                uploadedCount: savedIds.length
            });
        } catch (error) {
            // Roll back database records created by this request.
            await Promise.all(
                savedIds.map(async id => {
                    try {
                        await collection.deleteOne({ _id: id });
                    } catch (cleanupError) {
                        console.error(
                            "Could not remove image database record:",
                            cleanupError.message
                        );
                    }
                })
            );

            // Remove Cloudinary assets created by this request.
            await Promise.all(
                uploadedAssets.map(async publicId => {
                    try {
                        await cloudinary.uploader.destroy(publicId);
                    } catch (cleanupError) {
                        console.error(
                            "Could not remove Cloudinary asset:",
                            cleanupError.message
                        );
                    }
                })
            );

            return next(error);
        }
    }
);

// ================= PUBLIC: DISPLAY AN IMAGE =================

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

// ================= ADMIN: DELETE AN IMAGE =================

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

        return res.json({
            message: "Image deleted successfully."
        });
    } catch (error) {
        next(error);
    }
});

// ================= ERROR HANDLER =================

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

    console.error("Site image error:", {
        message: error.message,
        name: error.name,
        http_code: error.http_code
    });

    return res.status(500).json({
        message: "Could not process the image request."
    });
});

module.exports = router;
