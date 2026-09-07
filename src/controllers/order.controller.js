const orderService = require("../services/order.service");
const orderRepository = require("../repositories/order.repository");
const paymentRepository = require("../repositories/payment.repository");
const { emitOrderStatusUpdate, emitNewOrder, emitShipperOrderAssigned } = require("../socket/emitters");
const { VNPay, ignoreLogger, ProductCode, VnpLocale, dateFormat } = require('vnpay');
const { getDeliveryPrediction } = require("../utils/deliveryPrediction");

const callMlPrediction = getDeliveryPrediction;

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }

    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        return '127.0.0.1';
    }

    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

const buildVnpayClient = () => {
    const tmnCode = process.env.VNPAY_TMN_CODE;
    const secureSecret = process.env.VNPAY_HASH_SECRET;
    const vnpayHost = process.env.VNPAY_HOST || 'https://sandbox.vnpayment.vn';

    if (!tmnCode || !secureSecret) {
        throw new Error('VNPAY_CONFIG_MISSING');
    }

    return new VNPay({
        tmnCode,
        secureSecret,
        vnpayHost,
        testMode: true,
        hashAlgorithm: 'SHA512',
        loggerFn: ignoreLogger,
    });
};

const getAllOrders = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            status: String(req.query.status || "all").trim(),
            sortBy: String(req.query.sortBy || "created_at").trim(),
            sortDir: String(req.query.sortDir || "desc").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 5)
        };
        const result = await orderService.getAllOrders(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ success: false, message: "Failed to fetch orders" });
    }
};

const getOrdersByCustomerId = async (req, res) => {
    try {
        const customerId = req.user.id;
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            status: String(req.query.status || "all").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 8)
        };
        const result = await orderService.getOrdersByCustomerId(customerId, queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ success: false, message: "Failed to fetch orders" });
    }
};

const createOrUpdateOrder = async (req, res) => {
    try {
        const customerId = req.user.id;
        const orderData = req.body;
        const result = await orderService.createOrUpdateOrder(customerId, orderData);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error("Error creating order:", error);
        if (error.message === "DEFAULT_ADDRESS_REQUIRED") {
            return res.status(400).json({
                success: false,
                message: "Vui long thiet lap dia chi mac dinh truoc khi thanh toan"
            });
        }
        res.status(500).json({ success: false, message: "Failed to create order" });
    }
};

const getOrderByOrderCode = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const result = await orderService.getOrderByOrderCode(orderCode);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error fetching order:", error);
        res.status(500).json({ success: false, message: "Failed to fetch order" });
    }
};

const submitOrderReview = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const customerId = req.user.id;
        const { content, itemRatings } = req.body;

        const result = await orderService.submitOrderReview(orderCode, customerId, content, itemRatings);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error submitting order review:", error);

        const errorMap = {
            INVALID_REVIEW_CONTENT: { status: 400, message: "Nội dung đánh giá không được để trống." },
            INVALID_ITEM_RATINGS: { status: 400, message: "Vui lòng chấm sao cho từng món trong đơn." },
            INVALID_ITEM_RATING_VALUE: { status: 400, message: "Số sao mỗi món phải từ 1 đến 5." },
            MISSING_ITEM_RATING: { status: 400, message: "Bạn cần đánh giá đầy đủ tất cả món trong đơn." },
            ORDER_NOT_FOUND_OR_FORBIDDEN: { status: 404, message: "Không tìm thấy đơn hàng của bạn." },
            ORDER_NOT_COMPLETED: { status: 400, message: "Chỉ có thể đánh giá khi đơn hàng đã hoàn thành." }
        };

        const mapped = errorMap[error.message];
        if (mapped) {
            return res.status(mapped.status).json({ success: false, message: mapped.message });
        }

        res.status(500).json({ success: false, message: "Không thể gửi đánh giá." });
    }
};

const createQr = async (req, res) => {
    try {
        const { orderCode } = req.body;
        const normalizedOrderCode = String(orderCode || '').trim();

        if (!normalizedOrderCode) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu hoặc sai thông tin thanh toán VNPay.'
            });
        }

        const order = await orderRepository.getOrderByOrderCode(normalizedOrderCode);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
        }

        if (Number(order.customer_id) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền thanh toán đơn hàng này.' });
        }

        if (order.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa sẵn sàng để thanh toán.' });
        }

        const payment = await paymentRepository.getPaymentByOrderId(order.id);

        if (!payment || payment.method !== 'vnpay') {
            return res.status(400).json({ success: false, message: 'Đơn hàng không dùng phương thức VNPay.' });
        }

        if (payment.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Đơn hàng đã được thanh toán.' });
        }

        const orderAmount = Number(order.total_amount);

        if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Số tiền đơn hàng không hợp lệ.' });
        }

        const vnpay = buildVnpayClient();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const returnUrl = process.env.VNPAY_RETURN_URL || 'http://localhost:3000/api/orders/check-payment-vnpay';
        const paymentUrl = vnpay.buildPaymentUrl({
            vnp_Amount: Math.round(orderAmount),
            vnp_IpAddr: getClientIp(req),
            vnp_TxnRef: normalizedOrderCode,
            vnp_OrderInfo: `Thanh toan don hang ${normalizedOrderCode}`,
            vnp_OrderType: ProductCode.Other,
            vnp_ReturnUrl: returnUrl,
            vnp_Locale: VnpLocale.VN,
            vnp_CreateDate: dateFormat(new Date()),
            vnp_ExpireDate: dateFormat(tomorrow)
        });

        return res.status(201).json({
            success: true,
            data: {
                paymentUrl,
                orderCode: normalizedOrderCode,
                amount: orderAmount
            }
        });
    } catch (error) {
        console.error('Error creating VNPay payment URL:', error);

        if (error.message === 'VNPAY_CONFIG_MISSING') {
            return res.status(500).json({ success: false, message: 'Thiếu cấu hình VNPay trên server.' });
        }

        return res.status(500).json({ success: false, message: 'Không thể tạo link thanh toán VNPay.' });
    }
};

const vnpayReturn = async (req, res) => {
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
    const wantsJson = String(req.query.format || '').toLowerCase() === 'json';
    const redirectToFrontend = (success, orderCode = '', message = '', code = '') => {
        const params = new URLSearchParams({
            success: success ? '1' : '0',
            orderCode: String(orderCode || ''),
            message: String(message || ''),
            code: String(code || '')
        });
        return res.redirect(`${frontendBase}/vnpay-return?${params.toString()}`);
    };

    try {
        if (!process.env.VNPAY_HASH_SECRET || !process.env.VNPAY_TMN_CODE) {
            if (wantsJson) {
                return res.status(500).json({ success: false, message: 'Thiếu cấu hình bảo mật VNPay.' });
            }
            return redirectToFrontend(false, '', 'missing_vnpay_config', '500');
        }

        const verifyQuery = { ...req.query };
        delete verifyQuery.format;

        if (!verifyQuery.vnp_SecureHash) {
            if (wantsJson) {
                return res.status(400).json({ success: false, message: 'Thiếu chữ ký phản hồi VNPay.' });
            }
            return redirectToFrontend(false, '', 'missing_secure_hash', '400');
        }

        const vnpay = buildVnpayClient();
        const verifyResult = vnpay.verifyReturnUrl(verifyQuery);

        if (!verifyResult.isVerified) {
            if (wantsJson) {
                return res.status(400).json({
                    success: false,
                    message: 'Chữ ký VNPay không hợp lệ.',
                    data: verifyResult
                });
            }
            return redirectToFrontend(false, '', 'invalid_signature', '400');
        }

        const orderCode = String(verifyResult.vnp_TxnRef || '').trim();

        if (!orderCode) {
            if (wantsJson) {
                return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng từ VNPay.' });
            }
            return redirectToFrontend(false, '', 'missing_order_code', '400');
        }

        const order = await orderRepository.getOrderByOrderCode(orderCode);

        if (!order) {
            if (wantsJson) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.', data: req.query });
            }
            return redirectToFrontend(false, orderCode, 'order_not_found', '404');
        }

        const payment = await paymentRepository.getPaymentByOrderId(order.id);

        if (!payment) {
            if (wantsJson) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi thanh toán.', data: req.query });
            }
            return redirectToFrontend(false, orderCode, 'payment_not_found', '404');
        }

        if (payment.method !== 'vnpay') {
            if (wantsJson) {
                return res.status(400).json({ success: false, message: 'Đơn hàng không dùng phương thức VNPay.', data: req.query });
            }
            return redirectToFrontend(false, orderCode, 'invalid_payment_method', '400');
        }

        const responseCode = String(verifyResult.vnp_ResponseCode || '');
        const transactionStatus = String(verifyResult.vnp_TransactionStatus || '');
        const paidAmount = Number(verifyResult.vnp_Amount || 0);
        const orderAmount = Number(order.total_amount || 0);
        const amountMatched = Math.abs(paidAmount - orderAmount) < 0.01;
        const isSuccess = verifyResult.isSuccess && transactionStatus === '00' && amountMatched;

        // Idempotent callback handling: keep paid state if already marked paid.
        if (payment.payment_status === 'paid') {
            if (wantsJson) {
                return res.status(200).json({
                    success: true,
                    message: 'Đơn hàng đã thanh toán trước đó.',
                    data: {
                        ...req.query,
                        payment_status: payment.payment_status,
                        order_code: orderCode
                    }
                });
            }
            return redirectToFrontend(true, orderCode, 'already_paid', '00');
        }

        if (isSuccess) {
            const updatedPayment = await paymentRepository.markVnpayPaymentPaid(order.id);
            const successPayload = {
                success: true,
                message: 'Thanh toán thành công',
                data: {
                    ...req.query,
                    payment_status: updatedPayment?.payment_status || payment.payment_status,
                    order_code: orderCode
                }
            };
            if (wantsJson) {
                return res.status(200).json(successPayload);
            }
            return redirectToFrontend(true, orderCode, 'payment_success', responseCode || '00');
        }

        await paymentRepository.markOrderPaymentFailed(order.id);

        const failMessage = !amountMatched
            ? 'Thanh toán không hợp lệ do sai số tiền.'
            : 'Thanh toán thất bại';

        const failedPayload = {
            success: false,
            message: failMessage,
            data: {
                ...req.query,
                order_code: orderCode
            }
        };
        if (wantsJson) {
            return res.status(400).json(failedPayload);
        }
        return redirectToFrontend(false, orderCode, amountMatched ? 'payment_failed' : 'invalid_amount', responseCode || '99');
    } catch (error) {
        console.error('Error handling VNPay return:', error);
        if (wantsJson) {
            return res.status(500).json({ success: false, message: 'Lỗi xử lý callback VNPay.' });
        }
        return redirectToFrontend(false, '', 'server_error', '500');
    }
};

const confirmOrder = async (req, res) => {
    try {
        const now = new Date();
        const currentHour = now.getHours();
        if (currentHour < 6 || currentHour >= 22) {
            return res.status(400).json({
                success: false,
                message: "Nhà hàng chỉ phục vụ từ 6:00 đến 22:00. Vui lòng quay lại trong giờ hoạt động."
            });
        }

        const orderCode = req.params.orderCode;
        const orderData = req.body;
        const paymentMethod = req.body.paymentMethod;
        const result = await orderService.confirmOrder(orderCode, orderData, paymentMethod);

        let deliveryPrediction = null;
        try {
            const inputs = await orderRepository.getOrderPredictionInputs(orderCode);
            if (inputs?.ward_name) {
                deliveryPrediction = await callMlPrediction(inputs);
            }
        } catch (predictionError) {
            console.error("Predict after confirm failed:", predictionError.message || predictionError);
        }

        // Thông báo admin có đơn hàng mới
        emitNewOrder({ orderCode, status: 'pending' });

        res.status(200).json({ success: true, data: { ...result, deliveryPrediction } });
    } catch (error) {
        console.error("Error confirming order:", error);
        const errorMap = {
            ORDER_NOT_IN_CART: { status: 400, message: "Đơn hàng đã được xác nhận hoặc không còn ở trạng thái giỏ hàng." },
            VOUCHER_NOT_FOUND: { status: 404, message: "Voucher không tồn tại." },
            VOUCHER_INACTIVE: { status: 400, message: "Voucher hiện không hoạt động." },
            VOUCHER_EXPIRED: { status: 400, message: "Voucher đã hết hạn." },
            VOUCHER_USAGE_LIMIT_REACHED: { status: 400, message: "Voucher đã hết lượt sử dụng." },
            VOUCHER_CUSTOMER_LIMIT_REACHED: { status: 400, message: "Bạn đã sử dụng hết lượt cho voucher này." },
            VOUCHER_MIN_ORDER_NOT_MET: { status: 400, message: "Đơn hàng chưa đạt giá trị tối thiểu để áp dụng voucher." },
            INVALID_PAYMENT_METHOD: { status: 400, message: "Phương thức thanh toán không hợp lệ." },
            INVALID_DELIVERY_WARD: { status: 400, message: "Phường giao hàng không hợp lệ." },
            "Order not found": { status: 404, message: "Không tìm thấy đơn hàng." }
        };

        const mapped = errorMap[error.message];

        if (mapped) {
            return res.status(mapped.status).json({ success: false, message: mapped.message });
        }

        res.status(500).json({ success: false, message: "Failed to confirm order" });
    }
};

const cancelOrder = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const customerId = req.user?.id;
        const refundInfo = req.body?.refundInfo || null;
        const result = await orderService.cancelOrder(orderCode, customerId, refundInfo);
        if (result) {
            if (customerId) {
                emitOrderStatusUpdate(customerId, { orderCode, status: "cancelled" });
            }
            res.status(200).json({ success: true, data: result });
        } else {
            res.status(400).json({ success: false, message: "Failed to cancel order. Order may not be pending." });
        }
    } catch (error) {
        console.error("Error cancelling order:", error);
        const errorMap = {
            ORDER_NOT_FOUND: { status: 404, message: "Không tìm thấy đơn hàng." },
            FORBIDDEN_ORDER_ACCESS: { status: 403, message: "Bạn không có quyền hủy đơn hàng này." },
            ORDER_NOT_CANCELLABLE: { status: 400, message: "Chỉ có thể hủy đơn ở trạng thái chờ xác nhận hoặc đã xác nhận." },
            REFUND_INFO_REQUIRED: { status: 400, message: "Đơn hàng đã thanh toán. Vui lòng cung cấp thông tin chuyển khoản để hoàn tiền." }
        };

        const mapped = errorMap[error.message];
        if (mapped) {
            return res.status(mapped.status).json({ success: false, message: mapped.message });
        }

        res.status(500).json({ success: false, message: "Failed to cancel order" });
    }
};

const updateOrderStatus = async (req, res) => {
    const { status, ...payload } = req.body;

    if (status === "confirmed") {
        req.body = payload;
        return confirmOrder(req, res);
    }

    if (status === "cancelled") {
        return cancelOrder(req, res);
    }

    return res.status(400).json({ success: false, message: "Unsupported status" });
};

const updateOrderStatusByAdmin = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const { status, note, shipperId } = req.body;
        const changedBy = req.user?.id || null;

        const result = await orderService.updateOrderStatusByAdmin(orderCode, status, changedBy, note, shipperId || null);

        // Gửi thông báo cho customer (không block response)
        orderService.notifyCustomerOrderStatus(orderCode, status);

        // Real-time qua socket
        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (order?.customer_id) {
            emitOrderStatusUpdate(order.customer_id, { orderCode, status });
        }

        // Thông báo shipper khi được giao đơn
        const assignedShipperId = shipperId || order?.shipper_id;
        if (assignedShipperId && (status === "shipping" || status === "confirmed" || status === "preparing")) {
            emitShipperOrderAssigned(assignedShipperId, { orderCode, status });
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error updating order status by admin:", error);
        res.status(400).json({ success: false, message: error.message || "Failed to update order status" });
    }
};

const getShippers = async (req, res) => {
    try {
        const shippers = await orderService.getShippers();
        res.status(200).json({ success: true, data: shippers });
    } catch (error) {
        console.error("Error fetching shippers:", error);
        res.status(500).json({ success: false, message: "Failed to fetch shippers" });
    }
};

const getMyDeliveries = async (req, res) => {
    try {
        const shipperId = req.user.id;
        const result = await orderService.getOrdersByShipperId(shipperId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error fetching shipper deliveries:", error);
        res.status(500).json({ success: false, message: "Failed to fetch deliveries" });
    }
};

const getMyDeliveryHistory = async (req, res) => {
    try {
        const shipperId = req.user.id;
        const result = await orderService.getDeliveryHistoryByShipperId(shipperId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error fetching shipper delivery history:", error);
        res.status(500).json({ success: false, message: "Failed to fetch delivery history" });
    }
};

const completeDelivery = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const shipperId = req.user.id;
        const result = await orderService.completeDelivery(orderCode, shipperId);

        // Thông báo cho customer khi giao hàng hoàn thành
        orderService.notifyCustomerOrderStatus(orderCode, 'completed');

        // Real-time qua socket
        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (order?.customer_id) {
            emitOrderStatusUpdate(order.customer_id, { orderCode, status: 'completed' });
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error completing delivery:", error);
        const status = error.message === 'ORDER_NOT_FOUND' ? 404
            : error.message === 'NOT_ASSIGNED' ? 403
                : 400;
        const msg = error.message === 'ORDER_NOT_FOUND' ? 'Không tìm thấy đơn hàng'
            : error.message === 'NOT_ASSIGNED' ? 'Bạn không được phân công đơn này'
                : 'Không thể cập nhật trạng thái';
        res.status(status).json({ success: false, message: msg });
    }
};

const cancelDeliveryByShipper = async (req, res) => {
    try {
        const orderCode = req.params.orderCode;
        const shipperId = req.user.id;
        const reason = req.body?.reason || null;
        const result = await orderService.cancelDeliveryByShipper(orderCode, shipperId, reason);

        // Thông báo cho customer khi shipper hủy đơn
        orderService.notifyCustomerOrderStatus(orderCode, 'cancelled');

        // Real-time qua socket
        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (order?.customer_id) {
            emitOrderStatusUpdate(order.customer_id, { orderCode, status: 'cancelled' });
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Error cancelling delivery by shipper:", error);
        const status = error.message === 'ORDER_NOT_FOUND' ? 404
            : error.message === 'NOT_ASSIGNED' ? 403
                : 400;
        const msg = error.message === 'ORDER_NOT_FOUND' ? 'Không tìm thấy đơn hàng'
            : error.message === 'NOT_ASSIGNED' ? 'Bạn không được phân công đơn này'
                : error.message === 'ORDER_NOT_SHIPPING' ? 'Đơn hàng không ở trạng thái đang giao'
                    : 'Không thể hủy đơn hàng';
        res.status(status).json({ success: false, message: msg });
    }
};

const markTransferPaymentPaidByAdmin = async (req, res) => {
    try {
        const orderCode = String(req.params.orderCode || '').trim();

        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
        }

        const payment = await paymentRepository.getPaymentByOrderId(order.id);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi thanh toán.' });
        }

        if (payment.method !== 'transfer') {
            return res.status(400).json({ success: false, message: 'Đơn hàng không dùng phương thức chuyển khoản.' });
        }

        if (payment.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Đơn hàng đã được thanh toán trước đó.' });
        }

        const updated = await paymentRepository.markTransferPaymentPaid(order.id);
        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error('Error marking transfer payment paid:', error);
        return res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái thanh toán.' });
    }
};

const markPaymentRefundedByAdmin = async (req, res) => {
    try {
        const orderCode = String(req.params.orderCode || '').trim();

        const order = await orderRepository.getOrderByOrderCode(orderCode);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
        }

        if (order.status !== 'cancelled') {
            return res.status(400).json({ success: false, message: 'Chỉ hoàn tiền cho đơn đã hủy.' });
        }

        const payment = await paymentRepository.getPaymentByOrderId(order.id);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi thanh toán.' });
        }

        if (!(payment.method === 'transfer' || payment.method === 'vnpay')) {
            return res.status(400).json({ success: false, message: 'Đơn hàng này không yêu cầu hoàn tiền chuyển khoản.' });
        }

        if (payment.payment_status === 'refunded') {
            return res.status(400).json({ success: false, message: 'Đơn hàng đã được cập nhật hoàn tiền trước đó.' });
        }

        if (payment.payment_status !== 'paid') {
            return res.status(400).json({ success: false, message: 'Chỉ có thể hoàn tiền cho đơn đã thanh toán.' });
        }

        if (!payment.refund_requested_at || !payment.refund_bank_name || !payment.refund_account_number || !payment.refund_account_name) {
            return res.status(400).json({ success: false, message: 'Khách hàng chưa cung cấp đủ thông tin hoàn tiền.' });
        }

        const updated = await paymentRepository.markOrderPaymentRefundedByAdmin(order.id);
        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error('Error marking payment refunded:', error);
        return res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái hoàn tiền.' });
    }
};

const reorder = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { orderCode } = req.params;
        const result = await orderService.reorderToCart(orderCode, customerId);
        res.status(200).json({ success: true, data: result, message: `Đã thêm ${result.addedCount} món vào giỏ hàng.` });
    } catch (error) {
        console.error("Reorder failed:", error);
        const msg = error.message === "REORDER_NO_ITEMS"
            ? "Không có món nào khả dụng để đặt lại."
            : "Không thể đặt lại món. Vui lòng thử lại sau.";
        res.status(400).json({ success: false, message: msg });
    }
};

const predictDeliveryTime = async (req, res) => {
    try {
        const { ward_name, total_items, num_distinct, subtotal } = req.body;

        if (!ward_name) {
            return res.status(400).json({ success: false, message: "Thiếu tên phường." });
        }

        const prediction = await callMlPrediction({
            ward_name,
            total_items: Number(total_items) || 1,
            num_distinct: Number(num_distinct) || 1,
            order_hour: new Date().getHours(),
            day_of_week: (new Date().getDay() + 6) % 7,
            subtotal: Number(subtotal) || 0
        });

        res.status(200).json({
            success: true,
            data: {
                estimated_minutes: prediction.estimated_minutes || null,
                estimated_time: prediction.estimated_time || null,
                confidence: prediction.confidence || "unavailable",
                model: prediction.model || null
            }
        });
    } catch (error) {
        console.error("Prediction error:", error.message);
        res.status(200).json({
            success: true,
            data: {
                estimated_minutes: null,
                estimated_time: null,
                confidence: "unavailable",
                model: null
            }
        });
    }
};

module.exports = {
    createQr,
    vnpayReturn,
    getAllOrders,
    getOrdersByCustomerId,
    createOrUpdateOrder,
    getOrderByOrderCode,
    submitOrderReview,
    updateOrderStatus,
    updateOrderStatusByAdmin,
    getShippers,
    getMyDeliveries,
    getMyDeliveryHistory,
    completeDelivery,
    cancelDeliveryByShipper,
    markTransferPaymentPaidByAdmin,
    markPaymentRefundedByAdmin,
    reorder,
    predictDeliveryTime
};