
const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
    {
        customerName: {
            type: String,
            required: true,
            trim: true
        },

        phone: {
            type: String,
            required: true,
            trim: true
        },
        
quantity: {
    type: Number,
    required: true,
    min: 1
},

message: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ""
},


        service: {
            type: String,
            required: true,
            enum: [
                "Saree Pleating",
                "Box Folding",
                "Mehndi Design",
                "Bridal Mehndi"
            ]
        },

        bookingDate: {
            type: String,
            required: true
        },

        bookingTime: {
            type: String,
            required: true
        },

        referenceImageId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        },

        status: {
            type: String,
            enum: ["Pending", "Confirmed", "Completed", "Cancelled"],
            default: "Pending"
        }
    },
    {
        timestamps: true
    }
);

// Prevent two active bookings for the same date and time.
bookingSchema.index(
    { bookingDate: 1, bookingTime: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: ["Pending", "Confirmed"] }
        }
    }
);

module.exports = mongoose.model("Booking", bookingSchema);
