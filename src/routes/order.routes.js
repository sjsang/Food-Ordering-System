const express = require("express");
const router = express.Router();
const { authenticate, requireAnyRole, requireRole } = require("../middlewares/auth.middleware");

const orderController = require("../controllers/order.controller");

router.post("/", authenticate, requireRole("customer"), orderController.createOrUpdateOrder);
router.post("/predict-delivery", authenticate, requireRole("customer"), orderController.predictDeliveryTime);
router.get("/shippers", authenticate, requireRole("admin"), orderController.getShippers);
router.get("/my-deliveries", authenticate, requireRole("shipper"), orderController.getMyDeliveries);
router.get("/my-deliveries/history", authenticate, requireRole("shipper"), orderController.getMyDeliveryHistory);
router.get("/", authenticate, requireRole("admin"), orderController.getAllOrders);
router.get("/me", authenticate, requireRole("customer"), orderController.getOrdersByCustomerId);

router.post('/create-qr', authenticate, requireRole('customer'), orderController.createQr);
router.get('/check-payment-vnpay', orderController.vnpayReturn);

router.get("/:orderCode", authenticate, requireAnyRole("customer", "admin"), orderController.getOrderByOrderCode);
router.post("/:orderCode/reorder", authenticate, requireRole("customer"), orderController.reorder);
router.post("/:orderCode/review", authenticate, requireRole("customer"), orderController.submitOrderReview);
router.patch("/:orderCode/status", authenticate, requireRole("customer"), orderController.updateOrderStatus);
router.patch("/:orderCode/admin-status", authenticate, requireRole("admin"), orderController.updateOrderStatusByAdmin);
router.patch("/:orderCode/admin-payment", authenticate, requireRole("admin"), orderController.markTransferPaymentPaidByAdmin);
router.patch("/:orderCode/admin-payment-refunded", authenticate, requireRole("admin"), orderController.markPaymentRefundedByAdmin);
router.patch("/:orderCode/shipper-complete", authenticate, requireRole("shipper"), orderController.completeDelivery);
router.patch("/:orderCode/shipper-cancel", authenticate, requireRole("shipper"), orderController.cancelDeliveryByShipper);

module.exports = router;