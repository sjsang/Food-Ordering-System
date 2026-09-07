const express = require("express");

const { authenticate, requireRole } = require("../middlewares/auth.middleware");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

router.get("/overview", authenticate, requireRole("admin"), dashboardController.getDashboardOverview);
router.get("/statistics", authenticate, requireRole("admin"), dashboardController.getDashboardStatistics);

module.exports = router;