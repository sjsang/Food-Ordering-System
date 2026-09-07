const { getIO } = require("./index");

// Thông báo mới cho 1 customer
const emitNotification = (customerId, notification) => {
    try {
        getIO().to(`customer:${customerId}`).emit("notification:new", notification);
    } catch {
        // Socket chưa sẵn sàng, bỏ qua
    }
};

// Thông báo broadcast cho tất cả customer đang online
const emitNotificationBroadcast = (notification) => {
    try {
        const io = getIO();
        // Emit đến tất cả socket có role customer
        for (const [, socket] of io.of("/").sockets) {
            if (socket.user?.role === "customer") {
                socket.emit("notification:new", notification);
            }
        }
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Chat: tin nhắn mới trong conversation
const emitChatMessage = (conversationId, message) => {
    try {
        getIO().to(`chat:${conversationId}`).emit("chat:newMessage", message);
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Chat: cập nhật danh sách conversation (unread count, last message)
const emitChatUpdate = (conversationId, data) => {
    try {
        const io = getIO();
        io.to(`chat:${conversationId}`).emit("chat:conversationUpdated", data);
        // Cũng thông báo admin room để cập nhật danh sách
        io.to("admin_room").emit("chat:conversationUpdated", data);
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Chat: bot status thay đổi
const emitBotToggle = (conversationId, isBotActive) => {
    try {
        getIO().to(`chat:${conversationId}`).emit("chat:botToggled", { conversationId, isBotActive });
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Order: trạng thái đơn hàng thay đổi
const emitOrderStatusUpdate = (customerId, orderData) => {
    try {
        const io = getIO();
        io.to(`customer:${customerId}`).emit("order:statusUpdated", orderData);
        // Cũng thông báo admin room
        io.to("admin_room").emit("order:statusUpdated", orderData);
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Order: đơn hàng mới (admin nhận)
const emitNewOrder = (orderData) => {
    try {
        getIO().to("admin_room").emit("order:new", orderData);
    } catch {
        // Socket chưa sẵn sàng
    }
};

// Order: thông báo cho shipper khi được giao đơn
const emitShipperOrderAssigned = (shipperId, orderData) => {
    try {
        getIO().to(`shipper:${shipperId}`).emit("order:assigned", orderData);
    } catch {
        // Socket chưa sẵn sàng
    }
};

module.exports = {
    emitNotification,
    emitNotificationBroadcast,
    emitChatMessage,
    emitChatUpdate,
    emitBotToggle,
    emitOrderStatusUpdate,
    emitNewOrder,
    emitShipperOrderAssigned
};
