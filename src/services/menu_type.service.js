const menu_typeRepository = require("../repositories/menu_type.repository");

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const getMenuTypes = async () => {
    return await menu_typeRepository.getMenuTypes();
};

const createMenuType = async (name) => {
    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
        throw createHttpError(400, "Tên loại món không được để trống.");
    }

    try {
        return await menu_typeRepository.createMenuType(normalizedName);
    } catch (error) {
        if (error.code === "23505") {
            throw createHttpError(409, "Loại món này đã tồn tại.");
        }

        throw error;
    }
};

module.exports = {
    getMenuTypes,
    createMenuType
};