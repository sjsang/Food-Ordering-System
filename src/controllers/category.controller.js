const categoryService = require('../services/category.service');

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

const getCategories = async (req, res) => {
    try {
        const { type } = req.query;
        const data = await categoryService.getCategories(type);
        res.status(200).json(data);
    } catch (error) {
        sendError(res, error, "Không thể lấy danh sách danh mục.");
    }
};

const createCategory = async (req, res) => {
    try {
        const { name, menuTypeId } = req.body;
        const data = await categoryService.createCategory(name, menuTypeId);
        res.status(201).json({ success: true, data });
    } catch (error) {
        sendError(res, error, "Không thể tạo danh mục.");
    }
};

const updateCategory = async (req, res) => {
    try {
        const { name, menuTypeId } = req.body;
        const data = await categoryService.updateCategory(req.params.id, name, menuTypeId);
        res.status(200).json({ success: true, data });
    } catch (error) {
        sendError(res, error, "Không thể cập nhật danh mục.");
    }
};

const deleteCategory = async (req, res) => {
    try {
        const data = await categoryService.deleteCategory(req.params.id);
        res.status(200).json({ success: true, data });
    } catch (error) {
        sendError(res, error, "Không thể xóa danh mục.");
    }
};

module.exports = {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory
};