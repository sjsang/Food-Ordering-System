const express = require("express");
const router = express.Router();
const menuTypeController = require("../controllers/menu_type.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");

router.get("/", menuTypeController.getMenuTypes);
router.post("/", authenticate, requireRole("admin"), menuTypeController.createMenuType);

module.exports = router;