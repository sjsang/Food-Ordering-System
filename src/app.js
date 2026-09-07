const express = require("express");
const cors = require("cors");
const path = require("path");

const menuRoutes = require("./routes/menu.routes");
const categoryRoutes = require("./routes/category.routes");
const menuTypeRoutes = require("./routes/menu_type.routes");
const cartRoutes = require("./routes/cart.routes");
const authRoutes = require("./routes/auth.routes");
const orderRoutes = require("./routes/order.routes");
const customerRoutes = require("./routes/customer.routes");
const userRoutes = require("./routes/user.routes");
const wardRoutes = require("./routes/ward.routes");
const voucherRoutes = require("./routes/voucher.routes");
const reviewRoutes = require("./routes/review.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const chatRoutes = require("./routes/chat.routes");
const promotionRoutes = require("./routes/promotion.routes");
const notificationRoutes = require("./routes/notification.routes");
const feedbackRoutes = require("./routes/feedback.routes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/menus", menuRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/menu-types", menuTypeRoutes);
app.use("/api/cart-items", cartRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/wards", wardRoutes);
app.use("/api/vouchers", voucherRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/feedbacks", feedbackRoutes);

app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
});

module.exports = app;