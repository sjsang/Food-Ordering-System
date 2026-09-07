const notificationRepository = require('../repositories/notification.repository');

const getNotifications = async (customerId, queryOptions) => {
    return await notificationRepository.getNotificationsByCustomerId(customerId, queryOptions);
};

const getUnreadCount = async (customerId) => {
    return await notificationRepository.getUnreadCount(customerId);
};

const markAsRead = async (notificationId, customerId) => {
    return await notificationRepository.markAsRead(notificationId, customerId);
};

const markAllAsRead = async (customerId) => {
    return await notificationRepository.markAllAsRead(customerId);
};

const createNotification = async (data) => {
    return await notificationRepository.createNotification(data);
};

const deleteNotification = async (notificationId, customerId) => {
    return await notificationRepository.deleteNotification(notificationId, customerId);
};

// Tiện ích tạo thông báo theo loại
const notifyOrderStatusChange = async (customerId, orderCode, newStatus) => {
    const statusLabels = {
        confirmed: 'đã được xác nhận',
        preparing: 'đang được chuẩn bị',
        shipping: 'đang được giao',
        completed: 'đã hoàn thành',
        cancelled: 'đã bị hủy'
    };

    const label = statusLabels[newStatus] || newStatus;

    return await notificationRepository.createNotification({
        customerId,
        type: 'order',
        title: `Đơn hàng ${orderCode} ${label}`,
        message: `Đơn hàng ${orderCode} của bạn ${label}. Nhấn để xem chi tiết.`,
        link: `/orders/${orderCode}`
    });
};

const notifyNewPromotion = async (customerId, promotionName) => {
    return await notificationRepository.createNotification({
        customerId,
        type: 'promotion',
        title: `Khuyến mãi mới: ${promotionName}`,
        message: `Chương trình khuyến mãi "${promotionName}" đang diễn ra. Xem ngay!`,
        link: '/promotions'
    });
};

const notifyAllNewPromotion = async (promotionName) => {
    return await notificationRepository.createNotificationForAllCustomers({
        type: 'promotion',
        title: `Khuyến mãi mới: ${promotionName}`,
        message: `Chương trình khuyến mãi "${promotionName}" đang diễn ra. Xem ngay!`,
        link: '/promotions'
    });
};

const notifyAllNewVoucher = async (voucherCode) => {
    return await notificationRepository.createNotificationForAllCustomers({
        type: 'voucher',
        title: `Voucher mới: ${voucherCode}`,
        message: `Mã giảm giá "${voucherCode}" vừa được phát hành. Xem ngay!`,
        link: '/promotions'
    });
};

const notifyRankUp = async (customerId) => {
    return await notificationRepository.createNotification({
        customerId,
        type: 'rank',
        title: 'Chúc mừng! Bạn đã được thăng hạng',
        message: 'Bạn đã được nâng cấp lên hạng "Khách hàng thân quen". Cảm ơn bạn đã đồng hành cùng chúng tôi!',
        link: '/customers/me'
    });
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    createNotification,
    deleteNotification,
    notifyOrderStatusChange,
    notifyNewPromotion,
    notifyAllNewPromotion,
    notifyAllNewVoucher,
    notifyRankUp
};
