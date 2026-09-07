const promotionService = require('../services/promotion.service');
const notificationService = require('../services/notification.service');
const authRepository = require('../repositories/auth.repository');

const getPromotions = async (req, res) => {
    try {
        const { search, status, sortBy, sortDir, page, limit } = req.query;
        const result = await promotionService.getPromotions({ search, status, sortBy, sortDir, page, limit });
        res.json(result);
    } catch (error) {
        console.error('Error fetching promotions:', error);
        res.status(500).json({ error: 'Failed to fetch promotions' });
    }
};

const getPromotionById = async (req, res) => {
    const { id } = req.params;
    try {
        const promotion = await promotionService.getPromotionById(id);
        if (!promotion) {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        res.json(promotion);
    } catch (error) {
        console.error('Error fetching promotion by ID:', error);
        res.status(500).json({ error: 'Failed to fetch promotion' });
    }
};

const createPromotion = async (req, res) => {
    try {
        const promotionData = { ...req.body };
        if (promotionData.menu_type_ids && typeof promotionData.menu_type_ids === 'string') {
            promotionData.menu_type_ids = JSON.parse(promotionData.menu_type_ids);
        }
        if (promotionData.category_ids && typeof promotionData.category_ids === 'string') {
            promotionData.category_ids = JSON.parse(promotionData.category_ids);
        }
        if (promotionData.menu_item_ids && typeof promotionData.menu_item_ids === 'string') {
            promotionData.menu_item_ids = JSON.parse(promotionData.menu_item_ids);
        }
        const newPromotion = await promotionService.createPromotion(promotionData, req.file);

        // Gửi thông báo cho tất cả khách hàng
        notificationService.notifyAllNewPromotion(promotionData.name).catch(err =>
            console.error('Failed to notify customers about new promotion:', err)
        );

        res.status(201).json(newPromotion);
    } catch (error) {
        console.error('Error creating promotion:', error);
        res.status(error.status || 500).json({ error: error.message || 'Failed to create promotion' });
    }
};

const updatePromotion = async (req, res) => {
    const { id } = req.params;
    try {
        const promotionData = { ...req.body };
        if (promotionData.menu_type_ids && typeof promotionData.menu_type_ids === 'string') {
            promotionData.menu_type_ids = JSON.parse(promotionData.menu_type_ids);
        }
        if (promotionData.category_ids && typeof promotionData.category_ids === 'string') {
            promotionData.category_ids = JSON.parse(promotionData.category_ids);
        }
        if (promotionData.menu_item_ids && typeof promotionData.menu_item_ids === 'string') {
            promotionData.menu_item_ids = JSON.parse(promotionData.menu_item_ids);
        }
        const result = await promotionService.updatePromotion(id, promotionData, req.file);
        res.json(result);
    } catch (error) {
        if (error.message === 'PROMOTION_NOT_FOUND') {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        console.error('Error updating promotion:', error);
        res.status(error.status || 500).json({ error: error.message || 'Failed to update promotion' });
    }
};

const deletePromotion = async (req, res) => {
    const { id } = req.params;
    try {
        await promotionService.deletePromotion(id);
        res.json({ message: 'Promotion deleted successfully' });
    } catch (error) {
        if (error.message === 'PROMOTION_NOT_FOUND') {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        console.error('Error deleting promotion:', error);
        res.status(500).json({ error: 'Failed to delete promotion' });
    }
};

const togglePromotion = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await promotionService.togglePromotion(id);
        res.json(result);
    } catch (error) {
        if (error.message === 'PROMOTION_NOT_FOUND') {
            return res.status(404).json({ error: 'Promotion not found' });
        }
        console.error('Error toggling promotion:', error);
        res.status(500).json({ error: 'Failed to toggle promotion' });
    }
};

const getActivePromotionsForItems = async (req, res) => {
    try {
        const { menu_item_ids } = req.body;
        if (!Array.isArray(menu_item_ids) || menu_item_ids.length === 0) {
            return res.json([]);
        }
        let customerRank = 'normal';
        if (req.user?.id) {
            const customer = await authRepository.getCustomerById(req.user.id);
            customerRank = customer?.rank || 'normal';
        }
        const promotions = await promotionService.getActivePromotionsForItems(menu_item_ids, customerRank);
        res.json(promotions);
    } catch (error) {
        console.error('Error fetching active promotions for items:', error);
        res.status(500).json({ error: 'Failed to fetch active promotions' });
    }
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