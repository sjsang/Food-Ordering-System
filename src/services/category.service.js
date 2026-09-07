const categoryRepository = require('../repositories/category.repository');

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const parseCategoryId = (id) => {
    const parsed = Number(id);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw createHttpError(400, "Category ID không hợp lệ.");
    }

    return parsed;
};

const validateCategoryPayload = (name, menuTypeId) => {
    const normalizedName = String(name || "").trim();
    const parsedMenuTypeId = Number(menuTypeId);

    if (!normalizedName) {
        throw createHttpError(400, "Tên danh mục không được để trống.");
    }

    if (!Number.isInteger(parsedMenuTypeId) || parsedMenuTypeId <= 0) {
        throw createHttpError(400, "Loại món không hợp lệ.");
    }

    return {
        normalizedName,
        parsedMenuTypeId
    };
};

const mapDatabaseError = (error) => {
    if (error.code === "23503") {
        throw createHttpError(409, "Không thể xóa danh mục đang được sử dụng trong món ăn.");
    }

    throw error;
};

const getCategories = async (type) => {
    return await categoryRepository.getCategories(type);
};

const createCategory = async (name, menuTypeId) => {
    const { normalizedName, parsedMenuTypeId } = validateCategoryPayload(name, menuTypeId);
    const menuTypeFound = await categoryRepository.menuTypeExists(parsedMenuTypeId);

    if (!menuTypeFound) {
        throw createHttpError(404, "Không tìm thấy loại món.");
    }

    try {
        return await categoryRepository.createCategory(normalizedName, parsedMenuTypeId);
    } catch (error) {
        mapDatabaseError(error);
    }
};

const updateCategory = async (id, name, menuTypeId) => {
    const categoryId = parseCategoryId(id);
    const { normalizedName, parsedMenuTypeId } = validateCategoryPayload(name, menuTypeId);
    const menuTypeFound = await categoryRepository.menuTypeExists(parsedMenuTypeId);

    if (!menuTypeFound) {
        throw createHttpError(404, "Không tìm thấy loại món.");
    }

    try {
        const updated = await categoryRepository.updateCategory(categoryId, normalizedName, parsedMenuTypeId);

        if (!updated) {
            throw createHttpError(404, "Không tìm thấy danh mục.");
        }

        return updated;
    } catch (error) {
        mapDatabaseError(error);
    }
};

const deleteCategory = async (id) => {
    const categoryId = parseCategoryId(id);

    try {
        const deleted = await categoryRepository.deleteCategory(categoryId);

        if (!deleted) {
            throw createHttpError(404, "Không tìm thấy danh mục.");
        }

        return deleted;
    } catch (error) {
        mapDatabaseError(error);
    }
};

module.exports = {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory
};