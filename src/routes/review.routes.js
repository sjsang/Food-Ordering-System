const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

router.get('/admin', authenticate, requireRole('admin'), reviewController.getReviewsForAdmin);
router.patch('/:id/featured', authenticate, requireRole('admin'), reviewController.toggleFeaturedReview);

// Public endpoints – no auth required
router.get('/featured', reviewController.getFeaturedReviews);
router.get('/', reviewController.getRecentReviews);

module.exports = router;
