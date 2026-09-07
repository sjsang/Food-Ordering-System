const dashboardRepository = require("../repositories/dashboard.repository");

const getDashboardOverview = async (_req, res) => {
    try {
        const data = await dashboardRepository.getDashboardOverview();
        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Error fetching dashboard overview:", error);
        res.status(500).json({ success: false, message: "Không thể tải dữ liệu dashboard." });
    }
};

const getDashboardStatistics = async (req, res) => {
    try {
        const data = await dashboardRepository.getDashboardStatistics({
            fromDate: String(req.query.fromDate || "").trim(),
            toDate: String(req.query.toDate || "").trim(),
            status: String(req.query.status || "all").trim(),
            groupBy: String(req.query.groupBy || "day").trim(),
            topLimit: Number(req.query.topLimit || 5)
        });

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Error fetching dashboard statistics:", error);
        res.status(500).json({ success: false, message: "Không thể tải dữ liệu thống kê." });
    }
};

module.exports = {
    getDashboardOverview,
    getDashboardStatistics
};