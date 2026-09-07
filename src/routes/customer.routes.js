const express = require("express");
const router = express.Router();
const multer = require("multer");
const customerController = require("../controllers/customer.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");
const upload = multer({ dest: "uploads/" });

// Specific static routes must come before dynamic /:id routes
// Customer self-management routes
router.put("/me", authenticate, requireRole("customer"), customerController.updateCustomer);
router.patch("/me/avatar", authenticate, requireRole("customer"), upload.single("avatar"), customerController.updateCustomerAvatar);
router.delete("/me/avatar", authenticate, requireRole("customer"), customerController.deleteCustomerAvatar);
router.get("/me/rank", authenticate, requireRole("customer"), customerController.getMyRank);

// Address Management Routes
router.get("/addresses", authenticate, requireRole("customer"), customerController.getAddresses);
router.post("/addresses", authenticate, requireRole("customer"), customerController.addAddress);
router.post("/addresses/set-default", authenticate, requireRole("customer"), customerController.setDefaultAddress);
router.put("/addresses/:id", authenticate, requireRole("customer"), customerController.updateAddress);
router.delete("/addresses/:id", authenticate, requireRole("customer"), customerController.deleteAddress);

// Admin routes — dynamic param routes must be last
router.post("/", authenticate, requireRole("admin"), customerController.createCustomerByAdmin);
router.get("/", authenticate, requireRole("admin"), customerController.getCustomers);
router.get("/:id", authenticate, requireRole("admin"), customerController.getCustomerById);
router.patch("/:id/toggle-status", authenticate, requireRole("admin"), customerController.toggleCustomerStatus);
router.patch("/:id", authenticate, requireRole("admin"), customerController.updateCustomerByAdmin);

module.exports = router;