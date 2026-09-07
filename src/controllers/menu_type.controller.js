const menuTypeService = require("../services/menu_type.service");

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

const getMenuTypes = async (req, res) => {
    try {
        const data = await menuTypeService.getMenuTypes();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const createMenuType = async (req, res) => {
    try {
        const data = await menuTypeService.createMenuType(req.body.name);
        res.status(201).json({ success: true, data });
    } catch (error) {
        sendError(res, error, "Không thể tạo loại món.");
    }
};

module.exports = {
    getMenuTypes,
    createMenuType
};