const voucherService = require("../services/voucher.service");
const notificationService = require("../services/notification.service");
const authRepository = require('../repositories/auth.repository');

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

const getVouchers = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            sortBy: String(req.query.sortBy || "created_at").trim(),
            sortDir: String(req.query.sortDir || "desc").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 5)
        };

        const result = await voucherService.getVouchers(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        sendError(res, error, "Không thể lấy danh sách voucher.");
    }
};

const createVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.createVoucher(req.body || {});

        // Gửi thông báo cho tất cả khách hàng
        notificationService.notifyAllNewVoucher(voucher.code).catch(err =>
            console.error('Failed to notify customers about new voucher:', err)
        );

        res.status(201).json({ success: true, data: voucher });
    } catch (error) {
        sendError(res, error, "Không thể tạo voucher.");
    }
};

const updateVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.updateVoucher(req.params.id, req.body || {});
        res.status(200).json({ success: true, data: voucher });
    } catch (error) {
        sendError(res, error, "Không thể cập nhật voucher.");
    }
};

const deleteVoucher = async (req, res) => {
    try {
        const voucher = await voucherService.deleteVoucher(req.params.id);
        res.status(200).json({ success: true, data: voucher });
    } catch (error) {
        sendError(res, error, "Không thể xóa voucher.");
    }
};

const validateVoucher = async (req, res) => {
    try {
        const { code, orderValue } = req.body || {};
        let customerRank = 'normal';
        if (req.user?.id) {
            const customer = await authRepository.getCustomerById(req.user.id);
            customerRank = customer?.rank || 'normal';
        }
        const customerId = req.user?.id || null;
        const result = await voucherService.validateVoucherForOrder(code, orderValue, customerRank, customerId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        sendError(res, error, "Không thể áp dụng voucher.");
    }
};

const toggleVoucher = async (req, res) => {
    try {
        const voucherRepo = require('../repositories/voucher.repository');
        const voucher = await voucherRepo.toggleVoucher(req.params.id);
        if (!voucher) return res.status(404).json({ success: false, message: "Không tìm thấy voucher." });
        res.status(200).json({ success: true, data: voucher });
    } catch (error) {
        sendError(res, error, "Không thể thay đổi trạng thái voucher.");
    }
};

module.exports = {
    getVouchers,
    createVoucher,
    updateVoucher,
    deleteVoucher,
    validateVoucher,
    toggleVoucher
};
