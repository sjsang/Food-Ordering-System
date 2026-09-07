const db = require("../config/db");

const ALLOWED_STATUSES = ["all", "pending", "confirmed", "preparing", "shipping", "completed", "cancelled"];
const ALLOWED_GROUP_BY = ["day", "week"];

const normalizeDate = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
};

const createStatisticsFilters = ({ fromDate, toDate, status, groupBy, topLimit } = {}) => {
    const end = normalizeDate(toDate) || normalizeDate(new Date());
    const startDefault = new Date();
    startDefault.setDate(startDefault.getDate() - 29);
    const start = normalizeDate(fromDate) || normalizeDate(startDefault);

    const normalizedStart = start <= end ? start : end;
    const normalizedEnd = end >= start ? end : start;
    const normalizedStatus = ALLOWED_STATUSES.includes(status) ? status : "all";
    const normalizedGroupBy = ALLOWED_GROUP_BY.includes(groupBy) ? groupBy : "day";
    const normalizedTopLimit = Number.isInteger(Number(topLimit)) && Number(topLimit) > 0
        ? Math.min(Number(topLimit), 10)
        : 5;

    return {
        fromDate: normalizedStart,
        toDate: normalizedEnd,
        status: normalizedStatus,
        groupBy: normalizedGroupBy,
        topLimit: normalizedTopLimit
    };
};

const buildOrderFilter = ({ fromDate, toDate, status }, alias = "o") => {
    const params = [];
    const conditions = [`${alias}.status <> 'cart'`];

    params.push(fromDate);
    conditions.push(`DATE(${alias}.created_at) >= $${params.length}`);

    params.push(toDate);
    conditions.push(`DATE(${alias}.created_at) <= $${params.length}`);

    if (status && status !== "all") {
        params.push(status);
        conditions.push(`${alias}.status = $${params.length}`);
    }

    return {
        params,
        whereClause: `WHERE ${conditions.join(" AND ")}`
    };
};

const getDashboardOverview = async () => {
    const summaryQuery = `
        SELECT
            COALESCE(SUM(CASE WHEN o.status = 'completed' AND DATE(o.updated_at) = CURRENT_DATE THEN o.total_amount ELSE 0 END), 0) AS revenue_today,
            COUNT(CASE WHEN DATE(o.created_at) = CURRENT_DATE AND o.status <> 'cart' THEN 1 END)::int AS orders_today,
            COUNT(CASE WHEN o.status IN ('pending', 'confirmed', 'preparing', 'shipping') THEN 1 END)::int AS active_orders,
            COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::int AS completed_orders,
            COALESCE(AVG(r.rating), 0) AS average_rating
        FROM orders o
        LEFT JOIN order_reviews r ON r.order_id = o.id
    `;

    const weeklyRevenueQuery = `
        WITH days AS (
            SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
        ),
        revenue AS (
            SELECT
                DATE(updated_at) AS day,
                COALESCE(SUM(total_amount), 0) AS revenue
            FROM orders
            WHERE status = 'completed'
              AND DATE(updated_at) >= CURRENT_DATE - INTERVAL '6 days'
            GROUP BY DATE(updated_at)
        )
        SELECT
            days.day,
            COALESCE(revenue.revenue, 0) AS revenue
        FROM days
        LEFT JOIN revenue ON revenue.day = days.day
        ORDER BY days.day ASC
    `;

    const recentOrdersQuery = `
        SELECT
            o.order_code,
            o.delivery_full_name,
            o.total_amount,
            o.status,
            o.created_at
        FROM orders o
        WHERE o.status <> 'cart'
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 6
    `;

    const processingOrdersQuery = `
        SELECT
            o.order_code,
            o.delivery_full_name,
            o.delivery_phone,
            o.total_amount,
            o.status,
            o.created_at,
            o.updated_at
        FROM orders o
        WHERE o.status IN ('pending', 'confirmed', 'preparing', 'shipping')
        ORDER BY o.created_at ASC, o.id ASC
        LIMIT 10
    `;

    const recentReviewsQuery = `
        SELECT
            r.id,
            r.rating,
            r.content,
            r.created_at,
            c.full_name AS customer_name,
            o.order_code
        FROM order_reviews r
        JOIN customers c ON c.id = r.customer_id
        JOIN orders o ON o.id = r.order_id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 4
    `;

    const topSellingItemsQuery = `
        SELECT
            mi.id,
            mi.name,
            COALESCE(SUM(oi.quantity), 0)::int AS sold_quantity,
            COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE o.status NOT IN ('cart', 'cancelled')
        GROUP BY mi.id, mi.name
        ORDER BY sold_quantity DESC, revenue DESC, mi.name ASC
        LIMIT 5
    `;

    const [summaryResult, weeklyRevenueResult, recentOrdersResult, processingOrdersResult, recentReviewsResult, topSellingItemsResult] = await Promise.all([
        db.query(summaryQuery),
        db.query(weeklyRevenueQuery),
        db.query(recentOrdersQuery),
        db.query(processingOrdersQuery),
        db.query(recentReviewsQuery),
        db.query(topSellingItemsQuery)
    ]);

    const summary = summaryResult.rows[0] || {};

    return {
        summary: {
            revenueToday: Number(summary.revenue_today || 0),
            ordersToday: Number(summary.orders_today || 0),
            activeOrders: Number(summary.active_orders || 0),
            completedOrders: Number(summary.completed_orders || 0),
            averageRating: Number(summary.average_rating || 0)
        },
        weeklyRevenue: weeklyRevenueResult.rows.map((item) => ({
            date: item.day,
            revenue: Number(item.revenue || 0)
        })),
        recentOrders: recentOrdersResult.rows.map((item) => ({
            ...item,
            total_amount: Number(item.total_amount || 0)
        })),
        processingOrders: processingOrdersResult.rows.map((item) => ({
            ...item,
            total_amount: Number(item.total_amount || 0)
        })),
        recentReviews: recentReviewsResult.rows,
        topSellingItems: topSellingItemsResult.rows.map((item) => ({
            ...item,
            sold_quantity: Number(item.sold_quantity || 0),
            revenue: Number(item.revenue || 0)
        }))
    };
};

const getDashboardStatistics = async (rawFilters = {}) => {
    const filters = createStatisticsFilters(rawFilters);
    const { params, whereClause } = buildOrderFilter(filters, "o");
    const statusBreakdownWhere = whereClause;

    const summaryQuery = `
        SELECT
            COUNT(*)::int AS total_orders,
            COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::int AS completed_orders,
            COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END)::int AS cancelled_orders,
            COUNT(CASE WHEN o.status IN ('pending', 'confirmed', 'preparing', 'shipping') THEN 1 END)::int AS active_orders,
            COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS total_revenue,
            COALESCE(AVG(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE NULL END), 0) AS average_order_value
        FROM orders o
        ${whereClause}
    `;

    const paymentBreakdownQuery = `
        SELECT
            COALESCE(p.method, 'unknown') AS method,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(CASE WHEN o.status = 'completed' THEN p.amount ELSE 0 END), 0) AS revenue
        FROM orders o
        LEFT JOIN payments p ON p.order_id = o.id
        ${whereClause}
        GROUP BY COALESCE(p.method, 'unknown')
        ORDER BY order_count DESC, revenue DESC
    `;

    const statusBreakdownQuery = `
        SELECT o.status, COUNT(*)::int AS count
        FROM orders o
        ${statusBreakdownWhere}
        GROUP BY o.status
        ORDER BY count DESC, o.status ASC
    `;

    const topItemsParams = [...params, filters.topLimit];
    const topItemsQuery = `
        SELECT
            mi.id,
            mi.name,
            COALESCE(SUM(oi.quantity), 0)::int AS sold_quantity,
            COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        ${whereClause}
          AND o.status <> 'cancelled'
        GROUP BY mi.id, mi.name
        ORDER BY sold_quantity DESC, revenue DESC, mi.name ASC
        LIMIT $${topItemsParams.length}
    `;

    const customerMetricsParams = [...params, filters.fromDate, filters.toDate];
    const customerMetricsQuery = `
        WITH filtered_orders AS (
            SELECT o.id, o.customer_id
            FROM orders o
            ${whereClause}
        ),
        customer_history AS (
            SELECT
                customer_id,
                COUNT(*)::int AS total_orders
            FROM orders
            WHERE status <> 'cart'
            GROUP BY customer_id
        )
        SELECT
            COUNT(DISTINCT fo.customer_id)::int AS ordering_customers,
            COUNT(DISTINCT CASE
                WHEN c.created_at::date >= $${params.length + 1}
                 AND c.created_at::date <= $${params.length + 2}
                THEN c.id
            END)::int AS new_customers,
            COUNT(DISTINCT CASE WHEN ch.total_orders > 1 THEN fo.customer_id END)::int AS returning_customers
        FROM filtered_orders fo
        LEFT JOIN customers c ON c.id = fo.customer_id
        LEFT JOIN customer_history ch ON ch.customer_id = fo.customer_id
    `;

    const reviewSummaryQuery = `
        SELECT
            COUNT(r.id)::int AS review_count,
            COALESCE(AVG(r.rating), 0) AS average_rating,
            COUNT(CASE WHEN r.rating >= 4 THEN 1 END)::int AS positive_reviews
        FROM order_reviews r
        JOIN orders o ON o.id = r.order_id
        ${whereClause}
    `;

    const reviewBreakdownQuery = `
        SELECT ROUND(r.rating)::int AS rating, COUNT(*)::int AS count
        FROM order_reviews r
        JOIN orders o ON o.id = r.order_id
        ${whereClause}
        GROUP BY ROUND(r.rating)
        ORDER BY ROUND(r.rating) DESC
    `;

    const menuMetricsQuery = `
        WITH filtered_orders AS (
            SELECT o.id
            FROM orders o
            ${whereClause}
        ),
        sold_items AS (
            SELECT
                oi.menu_item_id,
                SUM(oi.quantity)::int AS sold_quantity
            FROM order_items oi
            JOIN filtered_orders fo ON fo.id = oi.order_id
            GROUP BY oi.menu_item_id
        )
        SELECT
            COUNT(*)::int AS total_items,
            COUNT(*) FILTER (WHERE mi.is_available = TRUE)::int AS active_items,
            COUNT(*) FILTER (WHERE mi.is_available = FALSE)::int AS inactive_items,
            COALESCE(SUM(COALESCE(si.sold_quantity, 0)), 0)::int AS sold_quantity
        FROM menu_items mi
        LEFT JOIN sold_items si ON si.menu_item_id = mi.id
    `;

    const categoryPerformanceParams = [...params, 6];
    const categoryPerformanceQuery = `
        SELECT
            c.id,
            c.name,
            COALESCE(SUM(oi.quantity), 0)::int AS sold_quantity,
            COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        JOIN categories c ON c.id = mi.category_id
        ${whereClause}
          AND o.status <> 'cancelled'
        GROUP BY c.id, c.name
        ORDER BY revenue DESC, sold_quantity DESC, c.name ASC
        LIMIT $${categoryPerformanceParams.length}
    `;

    const fulfillmentQuery = `
        SELECT
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 60)
                FILTER (WHERE o.status = 'completed'),
                0
            ) AS avg_fulfillment_minutes,
            COALESCE(
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 60
                )
                FILTER (WHERE o.status = 'completed'),
                0
            ) AS median_fulfillment_minutes
        FROM orders o
        ${whereClause}
    `;

    const voucherMetricsQuery = `
        SELECT
            COUNT(*) FILTER (WHERE ov.voucher_id IS NOT NULL)::int AS orders_with_voucher,
            COUNT(DISTINCT ov.voucher_id)::int AS unique_vouchers,
            COALESCE(SUM(CASE WHEN ov.voucher_id IS NOT NULL THEN o.discount_amount ELSE 0 END), 0) AS total_discount,
            COALESCE(SUM(CASE WHEN ov.voucher_id IS NOT NULL AND o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS revenue_with_voucher
        FROM orders o
        LEFT JOIN order_vouchers ov ON ov.order_id = o.id
        ${whereClause}
    `;

    const paymentStatusQuery = `
        SELECT
            COALESCE(p.payment_status, 'unknown') AS payment_status,
            COUNT(*)::int AS count
        FROM orders o
        LEFT JOIN payments p ON p.order_id = o.id
        ${whereClause}
        GROUP BY COALESCE(p.payment_status, 'unknown')
        ORDER BY count DESC
    `;

    const wardDemandQuery = `
        SELECT
            COALESCE(NULLIF(TRIM(o.delivery_ward_name), ''), 'Chưa xác định') AS ward_name,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS revenue
        FROM orders o
        ${whereClause}
        GROUP BY COALESCE(NULLIF(TRIM(o.delivery_ward_name), ''), 'Chưa xác định')
        ORDER BY order_count DESC, revenue DESC
    `;

    const customerRankingParams = [...params, filters.topLimit];
    const customerRankingQuery = `
        SELECT
            c.id,
            c.full_name,
            c.phone_number,
            c.rank,
            COUNT(o.id)::int AS order_count,
            COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS total_spent
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        ${whereClause}
        GROUP BY c.id, c.full_name, c.phone_number, c.rank
        ORDER BY total_spent DESC, order_count DESC
        LIMIT $${customerRankingParams.length}
    `;

    const customerRankDistributionQuery = `
        WITH filtered_customers AS (
            SELECT DISTINCT o.customer_id
            FROM orders o
            ${whereClause}
        )
        SELECT
            c.rank,
            COUNT(*)::int AS count
        FROM customers c
        JOIN filtered_customers fc ON fc.customer_id = c.id
        GROUP BY c.rank
        ORDER BY count DESC
    `;

    const promotionMetricsQuery = `
        WITH promo_items AS (
            SELECT oip.id AS promo_id, oip.discount_amount, oi.order_id
            FROM order_item_promotions oip
            JOIN order_items oi ON oi.id = oip.order_item_id
            JOIN orders o ON o.id = oi.order_id
            ${whereClause}
        ),
        promo_order_ids AS (
            SELECT DISTINCT order_id FROM promo_items
        )
        SELECT
            COUNT(pi.promo_id)::int AS promotion_usage_count,
            (SELECT COUNT(*)::int FROM promo_order_ids) AS orders_with_promotion,
            COALESCE(SUM(pi.discount_amount), 0) AS total_promotion_discount,
            COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.status = 'completed' AND o.id IN (SELECT order_id FROM promo_order_ids)), 0) AS revenue_with_promotion
        FROM promo_items pi
    `;

    const topPromotionsParams = [...params, 10];
    const topPromotionsQuery = `
        SELECT
            p.id,
            p.name,
            p.discount_percent,
            p.discount_amount AS flat_discount,
            COUNT(DISTINCT oi.order_id)::int AS order_count,
            COALESCE(SUM(oip.discount_amount), 0) AS total_discount_given
        FROM order_item_promotions oip
        JOIN promotions p ON p.id = oip.promotion_id
        JOIN order_items oi ON oi.id = oip.order_item_id
        JOIN orders o ON o.id = oi.order_id
        ${whereClause}
        GROUP BY p.id, p.name, p.discount_percent, p.discount_amount
        ORDER BY total_discount_given DESC, order_count DESC
        LIMIT $${topPromotionsParams.length}
    `;

    const staffMetricsQuery = `
        SELECT
            u.id,
            u.full_name,
            u.phone_number,
            u.role,
            u.is_active,
            COUNT(CASE WHEN o.status <> 'cart' THEN 1 END)::int AS assigned_orders,
            COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::int AS completed_orders,
            COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END)::int AS cancelled_orders,
            COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS delivered_revenue
        FROM users u
        LEFT JOIN orders o ON o.shipper_id = u.id
            AND DATE(o.created_at) >= $1
            AND DATE(o.created_at) <= $2
        WHERE u.role = 'shipper'
        GROUP BY u.id, u.full_name, u.phone_number, u.role, u.is_active
        ORDER BY completed_orders DESC, assigned_orders DESC
    `;

    const staffSummaryQuery = `
        SELECT
            COUNT(*) FILTER (WHERE role = 'admin')::int AS total_admins,
            COUNT(*) FILTER (WHERE role = 'shipper')::int AS total_shippers,
            COUNT(*) FILTER (WHERE role = 'shipper' AND is_active = TRUE)::int AS active_shippers,
            COUNT(*) FILTER (WHERE role = 'shipper' AND is_active = FALSE)::int AS inactive_shippers
        FROM users
    `;

    const trendQuery = filters.groupBy === "week"
        ? `
            WITH periods AS (
                SELECT generate_series(
                    date_trunc('week', $1::date),
                    date_trunc('week', $2::date),
                    INTERVAL '1 week'
                )::date AS period_start
            ),
            stats AS (
                SELECT
                    date_trunc('week', o.created_at)::date AS period_start,
                    COUNT(*)::int AS order_count,
                    COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::int AS completed_orders,
                    COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS revenue
                FROM orders o
                ${whereClause}
                GROUP BY date_trunc('week', o.created_at)::date
            )
            SELECT
                periods.period_start,
                COALESCE(stats.order_count, 0) AS order_count,
                COALESCE(stats.completed_orders, 0) AS completed_orders,
                COALESCE(stats.revenue, 0) AS revenue
            FROM periods
            LEFT JOIN stats ON stats.period_start = periods.period_start
            ORDER BY periods.period_start ASC
        `
        : `
            WITH periods AS (
                SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS period_start
            ),
            stats AS (
                SELECT
                    DATE(o.created_at) AS period_start,
                    COUNT(*)::int AS order_count,
                    COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::int AS completed_orders,
                    COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS revenue
                FROM orders o
                ${whereClause}
                GROUP BY DATE(o.created_at)
            )
            SELECT
                periods.period_start,
                COALESCE(stats.order_count, 0) AS order_count,
                COALESCE(stats.completed_orders, 0) AS completed_orders,
                COALESCE(stats.revenue, 0) AS revenue
            FROM periods
            LEFT JOIN stats ON stats.period_start = periods.period_start
            ORDER BY periods.period_start ASC
        `;

    const [
        summaryResult,
        trendResult,
        statusResult,
        paymentResult,
        topItemsResult,
        customerMetricsResult,
        reviewSummaryResult,
        reviewBreakdownResult,
        menuMetricsResult,
        categoryPerformanceResult,
        fulfillmentResult,
        voucherMetricsResult,
        paymentStatusResult,
        wardDemandResult,
        customerRankingResult,
        customerRankDistributionResult,
        promotionMetricsResult,
        topPromotionsResult,
        staffMetricsResult,
        staffSummaryResult
    ] = await Promise.all([
        db.query(summaryQuery, params),
        db.query(trendQuery, params),
        db.query(statusBreakdownQuery, params),
        db.query(paymentBreakdownQuery, params),
        db.query(topItemsQuery, topItemsParams),
        db.query(customerMetricsQuery, customerMetricsParams),
        db.query(reviewSummaryQuery, params),
        db.query(reviewBreakdownQuery, params),
        db.query(menuMetricsQuery, params),
        db.query(categoryPerformanceQuery, categoryPerformanceParams),
        db.query(fulfillmentQuery, params),
        db.query(voucherMetricsQuery, params),
        db.query(paymentStatusQuery, params),
        db.query(wardDemandQuery, params),
        db.query(customerRankingQuery, customerRankingParams),
        db.query(customerRankDistributionQuery, params),
        db.query(promotionMetricsQuery, params),
        db.query(topPromotionsQuery, topPromotionsParams),
        db.query(staffMetricsQuery, [filters.fromDate, filters.toDate]),
        db.query(staffSummaryQuery)
    ]);

    const summary = summaryResult.rows[0] || {};
    const customerMetrics = customerMetricsResult.rows[0] || {};
    const reviewSummary = reviewSummaryResult.rows[0] || {};
    const menuMetrics = menuMetricsResult.rows[0] || {};
    const fulfillmentMetrics = fulfillmentResult.rows[0] || {};
    const voucherMetrics = voucherMetricsResult.rows[0] || {};
    const promotionMetricsRow = promotionMetricsResult.rows[0] || {};
    const staffSummary = staffSummaryResult.rows[0] || {};
    const totalOrders = Number(summary.total_orders || 0);
    const cancelledOrders = Number(summary.cancelled_orders || 0);
    const completedOrders = Number(summary.completed_orders || 0);
    const orderingCustomers = Number(customerMetrics.ordering_customers || 0);
    const returningCustomers = Number(customerMetrics.returning_customers || 0);
    const reviewCount = Number(reviewSummary.review_count || 0);
    const positiveReviews = Number(reviewSummary.positive_reviews || 0);
    const ordersWithVoucher = Number(voucherMetrics.orders_with_voucher || 0);

    const alerts = [];

    if (totalOrders > 0 && (cancelledOrders / totalOrders) * 100 >= 12) {
        alerts.push({
            level: "warning",
            code: "high-cancellation-rate",
            message: "Tỷ lệ hủy đơn đang cao, nên kiểm tra quy trình xác nhận và năng lực chuẩn bị món."
        });
    }

    if (reviewCount >= 5 && Number(reviewSummary.average_rating || 0) < 4) {
        alerts.push({
            level: "warning",
            code: "low-customer-rating",
            message: "Điểm đánh giá trung bình dưới 4 sao, cần rà soát chất lượng phục vụ và món ăn."
        });
    }

    if (totalOrders > 0 && Number(summary.active_orders || 0) / totalOrders >= 0.35) {
        alerts.push({
            level: "info",
            code: "order-backlog",
            message: "Lượng đơn đang xử lý chiếm tỷ trọng cao, nên cân đối nhân sự bếp và giao hàng."
        });
    }

    if (alerts.length === 0) {
        alerts.push({
            level: "good",
            code: "stable-operation",
            message: "Vận hành đang ổn định trong phạm vi thời gian đã lọc."
        });
    }

    return {
        filters,
        summary: {
            totalOrders,
            completedOrders,
            cancelledOrders,
            activeOrders: Number(summary.active_orders || 0),
            totalRevenue: Number(summary.total_revenue || 0),
            averageOrderValue: Number(summary.average_order_value || 0),
            completionRate: totalOrders > 0 ? Number(((completedOrders / totalOrders) * 100).toFixed(1)) : 0,
            cancellationRate: totalOrders > 0 ? Number(((cancelledOrders / totalOrders) * 100).toFixed(1)) : 0
        },
        customerMetrics: {
            orderingCustomers,
            newCustomers: Number(customerMetrics.new_customers || 0),
            returningCustomers,
            repeatRate: orderingCustomers > 0 ? Number(((returningCustomers / orderingCustomers) * 100).toFixed(1)) : 0
        },
        reviewMetrics: {
            reviewCount,
            averageRating: Number(reviewSummary.average_rating || 0),
            positiveReviews,
            positiveRate: reviewCount > 0 ? Number(((positiveReviews / reviewCount) * 100).toFixed(1)) : 0,
            ratingBreakdown: reviewBreakdownResult.rows.map((item) => ({
                rating: Number(item.rating || 0),
                count: Number(item.count || 0)
            }))
        },
        menuMetrics: {
            totalItems: Number(menuMetrics.total_items || 0),
            activeItems: Number(menuMetrics.active_items || 0),
            inactiveItems: Number(menuMetrics.inactive_items || 0),
            soldQuantity: Number(menuMetrics.sold_quantity || 0),
            categoryPerformance: categoryPerformanceResult.rows.map((item) => ({
                id: item.id,
                name: item.name,
                soldQuantity: Number(item.sold_quantity || 0),
                revenue: Number(item.revenue || 0)
            }))
        },
        fulfillmentMetrics: {
            avgFulfillmentMinutes: Number(fulfillmentMetrics.avg_fulfillment_minutes || 0),
            medianFulfillmentMinutes: Number(fulfillmentMetrics.median_fulfillment_minutes || 0)
        },
        voucherMetrics: {
            ordersWithVoucher,
            uniqueVouchers: Number(voucherMetrics.unique_vouchers || 0),
            totalDiscount: Number(voucherMetrics.total_discount || 0),
            revenueWithVoucher: Number(voucherMetrics.revenue_with_voucher || 0),
            usageRate: totalOrders > 0 ? Number(((ordersWithVoucher / totalOrders) * 100).toFixed(1)) : 0
        },
        paymentStatusBreakdown: paymentStatusResult.rows.map((item) => ({
            paymentStatus: item.payment_status,
            count: Number(item.count || 0)
        })),
        wardDemand: wardDemandResult.rows.map((item) => ({
            wardName: item.ward_name,
            orderCount: Number(item.order_count || 0),
            revenue: Number(item.revenue || 0)
        })),
        customerRanking: customerRankingResult.rows.map((item) => ({
            id: item.id,
            fullName: item.full_name,
            phone: item.phone_number,
            rank: item.rank,
            orderCount: Number(item.order_count || 0),
            totalSpent: Number(item.total_spent || 0)
        })),
        customerRankDistribution: customerRankDistributionResult.rows.map((item) => ({
            rank: item.rank,
            count: Number(item.count || 0)
        })),
        promotionMetrics: {
            promotionUsageCount: Number(promotionMetricsRow.promotion_usage_count || 0),
            ordersWithPromotion: Number(promotionMetricsRow.orders_with_promotion || 0),
            totalPromotionDiscount: Number(promotionMetricsRow.total_promotion_discount || 0),
            revenueWithPromotion: Number(promotionMetricsRow.revenue_with_promotion || 0),
            promotionUsageRate: totalOrders > 0 ? Number(((Number(promotionMetricsRow.orders_with_promotion || 0) / totalOrders) * 100).toFixed(1)) : 0
        },
        topPromotions: topPromotionsResult.rows.map((item) => ({
            id: item.id,
            name: item.name,
            discountPercent: Number(item.discount_percent || 0),
            flatDiscount: Number(item.flat_discount || 0),
            orderCount: Number(item.order_count || 0),
            totalDiscountGiven: Number(item.total_discount_given || 0)
        })),
        staffMetrics: {
            summary: {
                totalAdmins: Number(staffSummary.total_admins || 0),
                totalShippers: Number(staffSummary.total_shippers || 0),
                activeShippers: Number(staffSummary.active_shippers || 0),
                inactiveShippers: Number(staffSummary.inactive_shippers || 0)
            },
            shippers: staffMetricsResult.rows.map((item) => ({
                id: item.id,
                fullName: item.full_name,
                phone: item.phone,
                isActive: item.is_active,
                assignedOrders: Number(item.assigned_orders || 0),
                completedOrders: Number(item.completed_orders || 0),
                cancelledOrders: Number(item.cancelled_orders || 0),
                deliveredRevenue: Number(item.delivered_revenue || 0),
                completionRate: Number(item.assigned_orders || 0) > 0
                    ? Number(((Number(item.completed_orders || 0) / Number(item.assigned_orders || 0)) * 100).toFixed(1))
                    : 0
            }))
        },
        alerts,
        trend: trendResult.rows.map((item) => ({
            periodStart: item.period_start,
            orderCount: Number(item.order_count || 0),
            completedOrders: Number(item.completed_orders || 0),
            revenue: Number(item.revenue || 0)
        })),
        statusBreakdown: statusResult.rows.map((item) => ({
            status: item.status,
            count: Number(item.count || 0)
        })),
        paymentBreakdown: paymentResult.rows.map((item) => ({
            method: item.method,
            orderCount: Number(item.order_count || 0),
            revenue: Number(item.revenue || 0)
        })),
        topItems: topItemsResult.rows.map((item) => ({
            ...item,
            sold_quantity: Number(item.sold_quantity || 0),
            revenue: Number(item.revenue || 0)
        }))
    };
};

module.exports = {
    getDashboardOverview,
    getDashboardStatistics
};