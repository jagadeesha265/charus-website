// =========================
// BOOKING FORM
// =========================

const bookingForm = document.getElementById("booking-form");
const referenceImage = document.getElementById("reference-image");
const imagePreview = document.getElementById("image-preview");
const bookingDate = document.getElementById("booking-date");


// =========================
// SET MINIMUM DATE
// =========================

if (bookingDate) {
    const today = new Date();

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    bookingDate.min = `${year}-${month}-${day}`;
}


// =========================
// REFERENCE IMAGE PREVIEW
// =========================

if (referenceImage) {

    referenceImage.addEventListener("change", function () {

        const file = this.files[0];

        if (!file) {
            imagePreview.style.display = "none";
            imagePreview.innerHTML = "";
            return;
        }

        if (!file.type.startsWith("image/")) {

            alert("Please select an image file.");

            this.value = "";
            imagePreview.style.display = "none";
            imagePreview.innerHTML = "";

            return;
        }

        const reader = new FileReader();

        reader.onload = function (event) {

            imagePreview.innerHTML = `
                <img 
                    src="${event.target.result}" 
                    alt="Reference Image Preview"
                >
            `;

            imagePreview.style.display = "block";
        };

        reader.readAsDataURL(file);
    });
}


// =========================
// WHATSAPP BOOKING
// =========================

if (bookingForm) {

    bookingForm.addEventListener("submit", function (event) {

        event.preventDefault();

        const name = document
            .getElementById("customer-name")
            .value
            .trim();

        const phone = document
            .getElementById("customer-phone")
            .value
            .trim();

        const service = document
            .getElementById("service")
            .value;

        const date = document
            .getElementById("booking-date")
            .value;

        const quantity = document
            .getElementById("quantity")
            .value;

        const message = document
            .getElementById("message")
            .value
            .trim();

        const hasReference =
            referenceImage &&
            referenceImage.files.length > 0;


        // Create WhatsApp message
        let whatsappMessage =
            "Hello Charu's,\n\n" +
            "I would like to book a service.\n\n" +

            "Name: " + name + "\n" +
            "Phone: " + phone + "\n" +
            "Service: " + service + "\n" +
            "Preferred Date: " + date + "\n" +
            "Number of Sarees / People: " + quantity + "\n";


        if (message) {
            whatsappMessage +=
                "Additional Message: " + message + "\n";
        }


        if (hasReference) {
            whatsappMessage +=
                "\nMehndi Reference: I have selected a reference image. " +
                "I will attach it in WhatsApp.\n";
        }


        whatsappMessage +=
            "\nThank you.";


        // Your WhatsApp number
        const whatsappNumber = "919591059947";


        // Encode the complete message
        const encodedMessage =
            encodeURIComponent(whatsappMessage);


        // WhatsApp URL
        const whatsappURL =
            "https://wa.me/" +
            whatsappNumber +
            "?text=" +
            encodedMessage;


        // Open WhatsApp
        window.location.href = whatsappURL;

    });
}
// =========================
// GALLERY LIGHTBOX
// =========================

const galleryItems =
    document.querySelectorAll(".gallery-item");

const galleryLightbox =
    document.getElementById("gallery-lightbox");

const lightboxImage =
    document.getElementById("lightbox-image");

const lightboxClose =
    document.getElementById("lightbox-close");


galleryItems.forEach(function (item) {

    item.addEventListener("click", function () {

        const image =
            item.querySelector("img");

        if (!image) return;

        lightboxImage.src = image.src;
        lightboxImage.alt = image.alt;

        galleryLightbox.classList.add("active");

        document.body.style.overflow = "hidden";
    });

});


// Close using X

lightboxClose.addEventListener("click", function () {

    galleryLightbox.classList.remove("active");

    document.body.style.overflow = "";
});


// Close by clicking outside the image

galleryLightbox.addEventListener("click", function (event) {

    if (event.target === galleryLightbox) {

        galleryLightbox.classList.remove("active");

        document.body.style.overflow = "";
    }

});


// Close using Escape key

document.addEventListener("keydown", function (event) {

    if (event.key === "Escape") {

        galleryLightbox.classList.remove("active");

        document.body.style.overflow = "";
    }

});
// =========================
// MOBILE MENU
// =========================

const menuToggle =
    document.getElementById("menu-toggle");

const navLinks =
    document.getElementById("nav-links");


if (menuToggle && navLinks) {

    // Open / close menu
    menuToggle.addEventListener("click", function () {

        navLinks.classList.toggle("active");

        if (navLinks.classList.contains("active")) {
            menuToggle.textContent = "✕";
        } else {
            menuToggle.textContent = "☰";
        }

    });


    // Close menu when a link is clicked
    navLinks.querySelectorAll("a").forEach(function (link) {

        link.addEventListener("click", function () {

            navLinks.classList.remove("active");

            menuToggle.textContent = "☰";

        });

    });

}