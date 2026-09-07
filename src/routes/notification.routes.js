const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const notificationController = require('../controllers/notification.controller');

router.get('/', authenticate, requireRole('customer'), notificationController.getNotifications);
router.get('/unread-count', authenticate, requireRole('customer'), notificationController.getUnreadCount);
router.patch('/read-all', authenticate, requireRole('customer'), notificationController.markAllAsRead);
router.patch('/:id/read', authenticate, requireRole('customer'), notificationController.markAsRead);
router.delete('/:id', authenticate, requireRole('customer'), notificationController.deleteNotification);

module.exports = router;
