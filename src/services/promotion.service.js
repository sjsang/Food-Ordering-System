const promotionRepository = require('../repositories/promotion.repository');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const validatePromotionData = (data) => {
    const { name, discount_percent, discount_amount, start_time, end_time, menu_type_ids, category_ids, menu_item_ids } = data;

    if (!name || !String(name).trim()) {
        throw createHttpError(400, "Tên chương trình không được để trống.");
    }

    const hasPercent = discount_percent !== null && discount_percent !== undefined && discount_percent !== '';
    const hasAmount = discount_amount !== null && discount_amount !== undefined && discount_amount !== '';

    if (!hasPercent && !hasAmount) {
        throw createHttpError(400, "Phải có giá trị giảm giá (phần trăm hoặc số tiền).");
    }

    if (hasPercent) {
        const pct = Number(discount_percent);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
            throw createHttpError(400, "Phần trăm giảm giá phải từ 1 đến 100.");
        }
    }

    if (hasAmount) {
        const amt = Number(discount_amount);
        if (!Number.isFinite(amt) || amt <= 0) {
            throw createHttpError(400, "Số tiền giảm giá phải lớn hơn 0.");
        }
    }

    if (!start_time) {
        throw createHttpError(400, "Ngày bắt đầu không được để trống.");
    }
    if (!end_time) {
        throw createHttpError(400, "Ngày kết thúc không được để trống.");
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (isNaN(startDate.getTime())) {
        throw createHttpError(400, "Ngày bắt đầu không hợp lệ.");
    }
    if (isNaN(endDate.getTime())) {
        throw createHttpError(400, "Ngày kết thúc không hợp lệ.");
    }
    if (endDate <= startDate) {
        throw createHttpError(400, "Ngày kết thúc phải sau ngày bắt đầu.");
    }

    const scope = data.scope || null;

    if (scope !== 'all') {
        const typeIds = Array.isArray(menu_type_ids) ? menu_type_ids : [];
        const catIds = Array.isArray(category_ids) ? category_ids : [];
        const itemIds = Array.isArray(menu_item_ids) ? menu_item_ids : [];

        if (typeIds.length === 0 && catIds.length === 0 && itemIds.length === 0) {
            throw createHttpError(400, "Phải chọn ít nhất một đối tượng áp dụng (loại thực đơn, danh mục hoặc món ăn).");
        }
    }
};

const getPromotions = async (queryOptions) => {
    return await promotionRepository.getPromotions(queryOptions);
};

const getPromotionById = async (id) => {
    return await promotionRepository.getPromotionByIdFull(id);
};

const createPromotion = async (promotionData, imageFile) => {
    validatePromotionData(promotionData);
    if (imageFile) {
        const result = await cloudinary.uploader.upload(imageFile.path, { folder: 'CADAO/promotions' });
        promotionData.image_url = result.public_id;
        fs.unlinkSync(imageFile.path);
    }
    return await promotionRepository.createPromotion(promotionData);
};

const updatePromotion = async (id, promotionData, imageFile) => {
    validatePromotionData(promotionData);
    if (imageFile) {
        const result = await cloudinary.uploader.upload(imageFile.path, { folder: 'CADAO/promotions' });
        promotionData.image_url = result.public_id;
        fs.unlinkSync(imageFile.path);
    }
    return await promotionRepository.updatePromotion(id, promotionData);
};

const deletePromotion = async (id) => {
    return await promotionRepository.deletePromotion(id);
};

const togglePromotion = async (id) => {
    return await promotionRepository.togglePromotion(id);
};

const getActivePromotionsForItems = async (menuItemIds, customerRank) => {
    return await promotionRepository.getActivePromotionsForItems(menuItemIds, customerRank);
};

module.exports = {
    getPromotions,
    getPromotionById,
    createPromotion,
    updatePromotion,
    deletePromotion,
    togglePromotion,
    getActivePromotionsForItems
};