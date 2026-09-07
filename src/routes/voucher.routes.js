const express = require("express");
const voucherController = require("../controllers/voucher.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");

const router = express.Router();

router.post("/validate", authenticate, requireRole("customer"), voucherController.validateVoucher);
router.get("/", authenticate, voucherController.getVouchers);
router.post("/", authenticate, requireRole("admin"), voucherController.createVoucher);
router.patch("/:id/toggle", authenticate, requireRole("admin"), voucherController.toggleVoucher);
router.put("/:id", authenticate, requireRole("admin"), voucherController.updateVoucher);
router.delete("/:id", authenticate, requireRole("admin"), voucherController.deleteVoucher);

module.exports = router;
