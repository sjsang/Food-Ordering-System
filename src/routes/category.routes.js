const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/category.controller");
const { authenticate, requireRole } = require("../middlewares/auth.middleware");

router.get("/", categoryController.getCategories);
router.post("/", authenticate, requireRole("admin"), categoryController.createCategory);
router.put("/:id", authenticate, requireRole("admin"), categoryController.updateCategory);
router.delete("/:id", authenticate, requireRole("admin"), categoryController.deleteCategory);

module.exports = router;