const wardService = require("../services/ward.service");

const sendError = (res, error, fallbackMessage) => {
    if (error.status) {
        return res.status(error.status).json({
            success: false,
            message: error.message
        });
    }

    console.error(fallbackMessage, error);
    return res.status(500).json({
        success: false,
        message: fallbackMessage
    });
};

const getWards = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            sortBy: String(req.query.sortBy || "name").trim(),
            sortDir: String(req.query.sortDir || "asc").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 5)
        };

        const result = await wardService.getWards(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        sendError(res, error, "Không thể lấy danh sách phường.");
    }
};

const createWard = async (req, res) => {
    try {
        const { name, shippingFee } = req.body;
        const ward = await wardService.createWard(name, shippingFee);
        res.status(201).json({ success: true, data: ward });
    } catch (error) {
        sendError(res, error, "Không thể tạo phường.");
    }
};

const updateWard = async (req, res) => {
    try {
        const { name, shippingFee } = req.body;
        const ward = await wardService.updateWard(req.params.id, name, shippingFee);
        res.status(200).json({ success: true, data: ward });
    } catch (error) {
        sendError(res, error, "Không thể cập nhật phường.");
    }
};

const deleteWard = async (req, res) => {
    try {
        const ward = await wardService.deleteWard(req.params.id);
        res.status(200).json({ success: true, data: ward });
    } catch (error) {
        sendError(res, error, "Không thể xóa phường.");
    }
};

module.exports = {
    getWards,
    createWard,
    updateWard,
    deleteWard
};