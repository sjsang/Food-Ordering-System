const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cart.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");

router.get("/", authenticate, requireRole("customer"), cartController.getCartItems);
router.post("/", authenticate, requireRole("customer"), cartController.addCartItem);
router.patch("/:menuItemId", authenticate, requireRole("customer"), cartController.updateCartItem);
router.delete("/:menuItemId", authenticate, requireRole("customer"), cartController.deleteCartItem);
router.delete("/", authenticate, requireRole("customer"), cartController.deleteAllCartItems);

module.exports = router;