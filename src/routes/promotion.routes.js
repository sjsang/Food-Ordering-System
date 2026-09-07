const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const promotionController = require('../controllers/promotion.controller');

router.get('/', promotionController.getPromotions);
router.post('/', authenticate, requireRole('admin'), upload.single('image'), promotionController.createPromotion);
router.post('/active-for-items', authenticate, promotionController.getActivePromotionsForItems);
router.get('/:id', promotionController.getPromotionById);
router.put('/:id', authenticate, requireRole('admin'), upload.single('image'), promotionController.updatePromotion);
router.patch('/:id/toggle', authenticate, requireRole('admin'), promotionController.togglePromotion);
router.delete('/:id', authenticate, requireRole('admin'), promotionController.deletePromotion);

module.exports = router;