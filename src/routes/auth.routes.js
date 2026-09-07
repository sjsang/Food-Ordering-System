const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticate, requireAnyRole, requireRole } = require("../middlewares/auth.middleware");

router.post("/customers", authController.registerCustomer);
router.post("/sessions", authController.loginCustomer);
router.delete("/sessions/current", authenticate, requireAnyRole("customer", "admin"), authController.logoutCustomer);
router.get("/sessions/current", authenticate, requireRole("customer"), authController.getCustomerById);

router.post("/admin/sessions", authController.loginAdmin);

module.exports = router;