const orderRepository = require("../repositories/order.repository");
const cartRepository = require("../repositories/cart.repository");
const notificationService = require("./notification.service");

const ADMIN_STATUS_TRANSITIONS = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["shipping", "cancelled"],
    shipping: ["completed"],
    completed: [],
    cancelled: []
};

const getAllOrders = async (queryOptions) => {
    return await orderRepository.getAllOrders(queryOptions);
};

const getOrdersByCustomerId = async (customerId, queryOptions) => {
    return await orderRepository.getOrdersByCustomerId(customerId, queryOptions);
};

const createOrUpdateOrder = async (customerId, orderData) => {
    return await orderRepository.createOrUpdateOrder(customerId, orderData);
};

const getOrderByOrderCode = async (orderCode) => {
    return await orderRepository.getOrderByOrderCode(orderCode);
};

const submitOrderReview = async (orderCode, customerId, content, itemRatings) => {
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (!normalizedContent) {
        throw new Error("INVALID_REVIEW_CONTENT");
    }

    if (!Array.isArray(itemRatings) || itemRatings.length === 0) {
        throw new Error("INVALID_ITEM_RATINGS");
    }

    return await orderRepository.submitOrderReview(orderCode, customerId, normalizedContent, itemRatings);
};

const confirmOrder = async (orderCode, orderData, paymentMethod) => {
    return await orderRepository.confirmOrder(orderCode, orderData, paymentMethod);
};

const cancelOrder = async (orderCode, customerId, refundInfo = null) => {
    const order = await orderRepository.getOrderByOrderCode(orderCode);

    if (!order) {
        throw new Error("ORDER_NOT_FOUND");
    }

    if (!['pending', 'confirmed'].includes(order.status)) {
        throw new Error("ORDER_NOT_CANCELLABLE");
    }

    return await orderRepository.cancelOrder(orderCode, customerId, refundInfo);
};

const getShippers = async () => {
    return await orderRepository.getShippers();
};

const updateOrderStatusByAdmin = async (orderCode, nextStatus, changedBy, note, shipperId = null) => {
    if (!changedBy) {
        throw new Error("Không xác định được người cập nhật đơn hàng");
    }

    const order = await orderRepository.getOrderByOrderCode(orderCode);

    if (!order) {
        throw new Error("Order not found");
    }

    const currentStatus = order.status;
    const allowedStatuses = ADMIN_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedStatuses.includes(nextStatus)) {
        throw new Error(`Cannot update order from ${currentStatus} to ${nextStatus}`);
    }

    const resolvedNote = nextStatus === "cancelled" && typeof note === "string"
        ? note.trim()
        : null;

    if (nextStatus === "cancelled" && !resolvedNote) {
        throw new Error("Cancel reason is required");
    }

    if (nextStatus === "shipping" && !shipperId) {
        throw new Error("Vui lòng chọn người giao hàng");
    }

    return await orderRepository.updateOrderStatus(orderCode, nextStatus, changedBy, resolvedNote, shipperId);
};

// Gửi thông báo cho customer khi admin thay đổi trạng thái đơn
const notifyCustomerOrderStatus = async (orderCode, newStatus) => {
    try {
        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (order && order.customer_id) {
            await notificationService.notifyOrderStatusChange(order.customer_id, orderCode, newStatus);

            // Kiểm tra thăng hạng khi đơn hoàn thành
            if (newStatus === 'completed') {
                checkAndNotifyRankUp(order.customer_id);
            }
        }
    } catch (err) {
        console.error("Failed to create order notification:", err.message);
    }
};

// Kiểm tra, cập nhật DB và gửi thông báo thăng hạng
const checkAndNotifyRankUp = async (customerId) => {
    try {
        const customerRepository = require("../repositories/customer.repository");
        const customerService = require("./customer.service");

        const oldCustomer = await customerRepository.getCustomerById(customerId);
        const oldRank = oldCustomer?.rank || 'normal';

        // Tính lại tổng chi tiêu và cập nhật rank + total_spent vào DB
        const { rank: newRank } = await customerService.recalcAndUpdateRank(customerId);

        // Chỉ thông báo khi vừa thăng hạng (trước đó normal, giờ loyal)
        if (oldRank === 'normal' && newRank === 'loyal') {
            await notificationService.notifyRankUp(customerId);
        }
    } catch (err) {
        console.error("Failed to check rank up:", err.message);
    }
};

const getOrdersByShipperId = async (shipperId) => {
    return await orderRepository.getOrdersByShipperId(shipperId);
};

const getDeliveryHistoryByShipperId = async (shipperId) => {
    return await orderRepository.getDeliveryHistoryByShipperId(shipperId);
};

const completeDelivery = async (orderCode, shipperId) => {
    return await orderRepository.completeDelivery(orderCode, shipperId);
};

const cancelDeliveryByShipper = async (orderCode, shipperId, reason) => {
    return await orderRepository.cancelDeliveryByShipper(orderCode, shipperId, reason);
};

const reorderToCart = async (orderCode, customerId) => {
    const items = await orderRepository.getOrderItemsForReorder(orderCode, customerId);

    if (!items || items.length === 0) {
        throw new Error("REORDER_NO_ITEMS");
    }

    for (const item of items) {
        await cartRepository.addCartItem(customerId, item.menu_item_id, item.quantity, item.note || "");
    }

    return { addedCount: items.length };
};

module.exports = {
    getAllOrders,
    getOrdersByCustomerId,
    createOrUpdateOrder,
    getOrderByOrderCode,
    submitOrderReview,
    confirmOrder,
    cancelOrder,
    updateOrderStatusByAdmin,
    getShippers,
    getOrdersByShipperId,
    getDeliveryHistoryByShipperId,
    completeDelivery,
    cancelDeliveryByShipper,
    notifyCustomerOrderStatus,
    reorderToCart
};