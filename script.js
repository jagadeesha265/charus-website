
"use strict";

// =========================
// BOOKING FORM
// =========================

const bookingForm = document.getElementById("booking-form");
const referenceImage = document.getElementById("reference-image");
const imagePreview = document.getElementById("image-preview");
const bookingDate = document.getElementById("booking-date");

const API_URL = "http://localhost:5000/api/bookings";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

// Set minimum booking date
if (bookingDate) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    bookingDate.min = `${year}-${month}-${day}`;
}

// Preview optional reference image
if (referenceImage && imagePreview) {
    referenceImage.addEventListener("change", function () {
        const file = this.files && this.files[0];

        if (!file) {
            imagePreview.style.display = "none";
            imagePreview.innerHTML = "";
            return;
        }

        if (
            !ALLOWED_IMAGE_TYPES.includes(file.type) ||
            file.size > MAX_IMAGE_SIZE
        ) {
            alert(
                "Please select a JPG, PNG, or WebP image up to 5 MB."
            );

            this.value = "";
            imagePreview.style.display = "none";
            imagePreview.innerHTML = "";
            return;
        }

        const reader = new FileReader();

        reader.onload = function (event) {
            imagePreview.innerHTML = "";

            const img = document.createElement("img");
            img.src = event.target.result;
            img.alt = "Reference Image Preview";

            imagePreview.appendChild(img);
            imagePreview.style.display = "block";
        };

        reader.onerror = function () {
            alert("Could not preview this image. Please try another.");
            referenceImage.value = "";
            imagePreview.style.display = "none";
            imagePreview.innerHTML = "";
        };

        reader.readAsDataURL(file);
    });
}

// Save booking and optional reference image to backend,
// then open WhatsApp.
if (bookingForm) {
    bookingForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = document
            .getElementById("customer-name")
            .value.trim();

        const phone = document
            .getElementById("customer-phone")
            .value.trim();

        const service = document.getElementById("service").value;
        const date = document.getElementById("booking-date").value;
        const time = document.getElementById("booking-time").value;

        const quantity = Number(
            document.getElementById("quantity").value
        );

        const message = document
            .getElementById("message")
            .value.trim();

        if (!name) {
            alert("Please enter your name.");
            return;
        }

        if (!/^[0-9]{10}$/.test(phone)) {
            alert("Please enter a valid 10-digit phone number.");
            return;
        }

        if (!date || !time) {
            alert("Please select your preferred date and time.");
            return;
        }

        if (!Number.isInteger(quantity) || quantity < 1) {
            alert("Please enter a valid quantity.");
            return;
        }

        const selectedFile =
            referenceImage && referenceImage.files
                ? referenceImage.files[0]
                : null;

        if (selectedFile) {
            if (!ALLOWED_IMAGE_TYPES.includes(selectedFile.type)) {
                alert("Please select a JPG, PNG, or WebP image.");
                return;
            }

            if (selectedFile.size > MAX_IMAGE_SIZE) {
                alert("Your reference image must be 5 MB or smaller.");
                return;
            }
        }

        const submitButton = bookingForm.querySelector(
            'button[type="submit"]'
        );

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Saving booking...";
        }

        try {
            // FormData sends text fields and the optional image together.
            const formData = new FormData();

            formData.append("customerName", name);
            formData.append("phone", phone);
            formData.append("service", service);
            formData.append("bookingDate", date);
            formData.append("bookingTime", time);
            formData.append("quantity", String(quantity));
            formData.append("message", message);

            if (selectedFile) {
                formData.append("referenceImage", selectedFile);
            }

            const response = await fetch(API_URL, {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                alert(
                    result.message ||
                    "Unable to save your booking. Please try again."
                );
                return;
            }

            // Prepare WhatsApp message after the booking is saved.
            let whatsappMessage =
                "Hello Charu's,\n\n" +
                "I have submitted a booking request.\n\n" +
                "Name: " + name + "\n" +
                "Phone: " + phone + "\n" +
                "Service: " + service + "\n" +
                "Preferred Date: " + date + "\n" +
                "Preferred Time: " + time + "\n" +
                "Number of Sarees / People: " + quantity + "\n" +
                "Booking ID: " + result.booking.id + "\n";

            if (message) {
                whatsappMessage +=
                    "Additional Message: " + message + "\n";
            }

            if (selectedFile) {
                whatsappMessage +=
                    "\nI have uploaded a reference image with my booking. " +
                    "I can also attach it here in WhatsApp if needed.\n";
            }

            whatsappMessage += "\nThank you.";

            const whatsappURL =
                "https://wa.me/919591059947?text=" +
                encodeURIComponent(whatsappMessage);

            // Reset form after successful database save.
            bookingForm.reset();

            if (imagePreview) {
                imagePreview.style.display = "none";
                imagePreview.innerHTML = "";
            }

            // Open WhatsApp after saving.
            window.location.href = whatsappURL;

        } catch (error) {
            console.error("Booking request failed:", error);

            alert(
                "Could not connect to the booking server. " +
                "Please try again. If you are unsure whether the booking " +
                "was saved, check before submitting it again."
            );

        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Book via WhatsApp";
            }
        }
    });
}

// =========================
// GALLERY LIGHTBOX
// =========================

const galleryItems = document.querySelectorAll(".gallery-item");
const galleryLightbox = document.getElementById("gallery-lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");

if (galleryLightbox && lightboxImage) {
    galleryItems.forEach(function (item) {
        item.addEventListener("click", function () {
            const image = item.querySelector("img");

            if (!image) return;

            lightboxImage.src = image.src;
            lightboxImage.alt = image.alt;

            galleryLightbox.classList.add("active");
            document.body.style.overflow = "hidden";
        });
    });

    // Close using X.
    if (lightboxClose) {
        lightboxClose.addEventListener("click", function () {
            galleryLightbox.classList.remove("active");
            document.body.style.overflow = "";
        });
    }

    // Close by clicking outside the image.
    galleryLightbox.addEventListener("click", function (event) {
        if (event.target === galleryLightbox) {
            galleryLightbox.classList.remove("active");
            document.body.style.overflow = "";
        }
    });

    // Close using Escape.
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            galleryLightbox.classList.remove("active");
            document.body.style.overflow = "";
        }
    });
}

// =========================
// MOBILE MENU
// =========================

const menuToggle = document.getElementById("menu-toggle");
const navLinks = document.getElementById("nav-links");

if (menuToggle && navLinks) {
    // Open / close menu.
    menuToggle.addEventListener("click", function () {
        navLinks.classList.toggle("active");

        menuToggle.textContent =
            navLinks.classList.contains("active") ? "✕" : "☰";
    });

    // Close menu when a link is clicked.
    navLinks.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            navLinks.classList.remove("active");
            menuToggle.textContent = "☰";
        });
    });
}
