const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const menuController = require("../controllers/menu.controller");
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

router.get("/", menuController.getMenuItems);
router.get("/featured", menuController.getFeaturedMenuItems);
router.patch("/:id/featured", authenticate, requireRole('admin'), menuController.toggleFeaturedMenuItem);
router.get("/:id", menuController.getMenuItemById);
router.post("/", upload.single("image"), menuController.createMenuItem);
router.put("/:id", upload.single("image"), menuController.updateMenuItem);

module.exports = router;