const userController = require("../controllers/user.controller");
const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticate, requireAnyRole, requireRole } = require("../middlewares/auth.middleware");
const upload = multer({ dest: "uploads/" });

router.post("/", authenticate, requireRole("admin"), userController.createUserByAdmin);
router.get("/", authenticate, requireRole("admin"), userController.getUsers);
router.get("/me", authenticate, requireAnyRole("admin", "shipper"), userController.getMyProfile);
router.patch("/me", authenticate, requireAnyRole("admin", "shipper"), userController.updateMyProfile);
router.patch("/me/avatar", authenticate, requireAnyRole("admin", "shipper"), upload.single("avatar"), userController.updateMyAvatar);
router.delete("/me/avatar", authenticate, requireAnyRole("admin", "shipper"), userController.deleteMyAvatar);
router.get("/:id", authenticate, requireRole("admin"), userController.getUserById);
router.patch("/:id/toggle-status", authenticate, requireRole("admin"), userController.toggleUserStatus);
router.patch("/:id", authenticate, requireRole("admin"), userController.updateUser);

module.exports = router;