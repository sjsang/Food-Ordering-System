const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedback.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

// Public — khách gửi góp ý
router.post('/', feedbackController.createFeedback);

// Admin — quản lý góp ý
router.get('/', authenticate, requireRole('admin'), feedbackController.getAllFeedbacks);
router.patch('/:id/read', authenticate, requireRole('admin'), feedbackController.toggleReadFeedback);
router.delete('/:id', authenticate, requireRole('admin'), feedbackController.deleteFeedback);

module.exports = router;
