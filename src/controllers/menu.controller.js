const menuService = require("../services/menu.service");

const getMenuItems = async (req, res) => {
    try {
        const { type, category, search, sort, available, featured, page, limit } = req.query;

        const result = await menuService.getMenuItems({
            type,
            category,
            search,
            sort,
            available,
            featured,
            page,
            limit
        });

        const hasPagination = page !== undefined || limit !== undefined;
        if (hasPagination) {
            return res.json({ data: result.data, pagination: result.pagination });
        }

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getMenuItemById = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await menuService.getMenuItemById(id);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const createMenuItem = async (req, res) => {
    try {
        const { name, description, price, categoryId, isAvailable } = req.body;
        const imageFile = req.file;
        const data = await menuService.createMenuItem(name, description, price, categoryId, isAvailable, imageFile);
        res.status(201).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const updateMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, categoryId, isAvailable } = req.body;
        const imageFile = req.file;
        const data = await menuService.updateMenuItem(id, name, description, price, categoryId, isAvailable, imageFile);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getFeaturedMenuItems = async (req, res) => {
    try {
        const data = await menuService.getFeaturedMenuItems();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const toggleFeaturedMenuItem = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }

        const updated = await menuService.toggleFeaturedMenuItem(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy món ăn.' });
        }

        res.status(200).json({ success: true, data: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = {
    getMenuItems,
    getMenuItemById,
    createMenuItem,
    updateMenuItem,
    getFeaturedMenuItems,
    toggleFeaturedMenuItem
};