const chatService = require("../services/chat.service");
const { emitChatMessage, emitChatUpdate, emitBotToggle, emitNewOrder } = require("../socket/emitters");

const parseConversationId = (value) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        const error = new Error("conversationId không hợp lệ.");
        error.status = 400;
        throw error;
    }

    return id;
};

const sendError = (res, error, fallbackMessage) => {
    if (error.status) {
        return res.status(error.status).json({
            success: false,
            message: error.message
        });
    }

    console.error(fallbackMessage, error);
    return res.status(500).json({
        success: false,
        message: fallbackMessage
    });
};

const startConversation = async (req, res) => {
    try {
        const conversation = await chatService.startConversation(req.user.id);
        return res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        return sendError(res, error, "Không thể tạo hoặc lấy hội thoại chat.");
    }
};

const startConversationByAdmin = async (req, res) => {
    try {
        const { customerId } = req.body;
        if (!customerId) {
            return res.status(400).json({ success: false, message: "customerId là bắt buộc." });
        }
        const conversation = await chatService.startConversationByAdmin(req.user.id, customerId);
        return res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        return sendError(res, error, "Không thể tạo hội thoại với khách hàng.");
    }
};

const sendMessage = async (req, res) => {
    try {
        const { conversationId, text } = req.body || {};
        const result = await chatService.sendMessage({
            currentUser: req.user,
            conversationId: parseConversationId(conversationId),
            text
        });

        // Emit real-time events
        const parsedConvId = parseConversationId(conversationId);
        if (result.userMessage) {
            emitChatMessage(parsedConvId, result.userMessage);
        }
        if (result.aiMessage) {
            emitChatMessage(parsedConvId, result.aiMessage);
        }
        emitChatUpdate(parsedConvId, { conversationId: parsedConvId });

        // Đặt hàng qua chatbot: thông báo admin + gửi dự đoán giao hàng cho customer
        if (result.orderPlaced) {
            const { orderCode, customerId, estimatedMinutes, estimatedTime } = result.orderPlaced;
            emitNewOrder({ orderCode, status: "pending" });
            if (estimatedTime) {
                try {
                    const { getIO } = require("../socket");
                    getIO().to(`customer:${customerId}`).emit("order:deliveryPrediction", {
                        orderCode, estimatedMinutes, estimatedTime
                    });
                } catch { /* socket chưa sẵn sàng */ }
            }
        }

        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error, "Không thể gửi tin nhắn chat.");
    }
};

const getMessages = async (req, res) => {
    try {
        const conversationId = parseConversationId(req.params.conversationId);
        const messages = await chatService.getMessages({
            currentUser: req.user,
            conversationId
        });

        return res.status(200).json({ success: true, data: messages });
    } catch (error) {
        return sendError(res, error, "Không thể lấy danh sách tin nhắn.");
    }
};

const getConversations = async (req, res) => {
    try {
        const conversations = await chatService.getConversations(req.user);
        return res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        return sendError(res, error, "Không thể lấy danh sách hội thoại.");
    }
};

const toggleBot = async (req, res) => {
    try {
        const conversationId = parseConversationId(req.params.conversationId);
        const { isBotActive } = req.body || {};
        const conversation = await chatService.toggleBot({
            currentUser: req.user,
            conversationId,
            isBotActive
        });

        emitBotToggle(conversationId, conversation.is_bot_active);

        return res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        return sendError(res, error, "Không thể cập nhật trạng thái bot.");
    }
};

const markMessagesAsRead = async (req, res) => {
    try {
        const conversationId = parseConversationId(req.params.conversationId);
        await chatService.markMessagesAsRead({
            currentUser: req.user,
            conversationId
        });

        return res.status(200).json({ success: true, message: "Đã đánh dấu tin nhắn là đã đọc." });
    } catch (error) {
        return sendError(res, error, "Không thể cập nhật trạng thái đã đọc.");
    }
};

const getUnreadCount = async (req, res) => {
    try {
        const unreadCount = await chatService.getUnreadCount(req.user);
        return res.status(200).json({ success: true, data: { unreadCount } });
    } catch (error) {
        return sendError(res, error, "Không thể lấy số tin chưa đọc.");
    }
};



const getChatDashboardStats = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query || {};
        const result = await chatService.getChatDashboardStats({ fromDate, toDate });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error, "Không thể lấy thống kê chatbot.");
    }
};

const getConversationSummary = async (req, res) => {
    try {
        const conversationId = parseConversationId(req.params.conversationId);
        const result = await chatService.getConversationSummary({ conversationId });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return sendError(res, error, "Không thể tóm tắt hội thoại.");
    }
};

const deleteConversation = async (req, res) => {
    try {
        const conversationId = parseConversationId(req.params.conversationId);
        await chatService.deleteConversation(conversationId);
        return res.status(200).json({ success: true, message: "Đã xóa hội thoại." });
    } catch (error) {
        return sendError(res, error, "Không thể xóa hội thoại.");
    }
};

module.exports = {
    startConversation,
    startConversationByAdmin,
    sendMessage,
    getMessages,
    getConversations,
    toggleBot,
    markMessagesAsRead,
    getUnreadCount,
    getChatDashboardStats,
    getConversationSummary,
    deleteConversation
};
