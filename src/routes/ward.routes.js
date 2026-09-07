const express = require("express");
const wardController = require("../controllers/ward.controller");
const { authenticate, requireAnyRole, requireRole } = require("../middlewares/auth.middleware");

const router = express.Router();

router.get("/", authenticate, requireAnyRole("admin", "customer"), wardController.getWards);
router.post("/", authenticate, requireRole("admin"), wardController.createWard);
router.put("/:id", authenticate, requireRole("admin"), wardController.updateWard);
router.delete("/:id", authenticate, requireRole("admin"), wardController.deleteWard);

module.exports = router;