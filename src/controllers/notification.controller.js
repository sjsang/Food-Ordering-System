const notificationService = require('../services/notification.service');

const getNotifications = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { page, limit } = req.query;
        const result = await notificationService.getNotifications(customerId, { page, limit });
        res.json(result);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

const getUnreadCount = async (req, res) => {
    try {
        const customerId = req.user.id;
        const count = await notificationService.getUnreadCount(customerId);
        res.json({ count });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
};

const markAsRead = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { id } = req.params;
        const success = await notificationService.markAsRead(id, customerId);
        if (!success) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        res.json({ message: 'Marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
};

const markAllAsRead = async (req, res) => {
    try {
        const customerId = req.user.id;
        await notificationService.markAllAsRead(customerId);
        res.json({ message: 'All marked as read' });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
};

const deleteNotification = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { id } = req.params;
        const success = await notificationService.deleteNotification(id, customerId);
        if (!success) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification
};
