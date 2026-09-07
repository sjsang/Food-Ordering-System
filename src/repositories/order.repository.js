const db = require('../config/db');
const {
    getPaymentByOrderId,
    createPayment,
    markCashPaymentPaid,
    markOrderPaymentFailed,
    markOrderPaymentRefunded,
    saveRefundRequestInfo
} = require('./payment.repository');

const toSafeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getVoucherForUpdate = async (voucherId, client = db) => {
    const result = await client.query(
        `
            SELECT id, code, discount_percent, discount_amount, min_order_value, max_discount,
                   expiry_date, usage_limit, used_count, max_usage_per_customer, is_active
            FROM vouchers
            WHERE id = $1
            FOR UPDATE
        `,
        [voucherId]
    );

    return result.rows[0] || null;
};

const calculateVoucherDiscount = (voucher, subtotal, customerVoucherUsed = 0) => {
    if (!voucher) {
        return 0;
    }

    if (!voucher.is_active) {
        throw new Error("VOUCHER_INACTIVE");
    }

    if (voucher.expiry_date && new Date(voucher.expiry_date).getTime() < Date.now()) {
        throw new Error("VOUCHER_EXPIRED");
    }

    if (voucher.usage_limit !== null && Number(voucher.used_count) >= Number(voucher.usage_limit)) {
        throw new Error("VOUCHER_USAGE_LIMIT_REACHED");
    }

    if (voucher.max_usage_per_customer !== null && customerVoucherUsed >= Number(voucher.max_usage_per_customer)) {
        throw new Error("VOUCHER_CUSTOMER_LIMIT_REACHED");
    }

    const minOrderValue = toSafeNumber(voucher.min_order_value, 0);

    if (subtotal < minOrderValue) {
        throw new Error("VOUCHER_MIN_ORDER_NOT_MET");
    }

    let discountAmount = 0;

    if (voucher.discount_percent !== null) {
        discountAmount = (subtotal * Number(voucher.discount_percent)) / 100;

        if (voucher.max_discount !== null) {
            discountAmount = Math.min(discountAmount, Number(voucher.max_discount));
        }
    } else {
        discountAmount = toSafeNumber(voucher.discount_amount, 0);
    }

    return Math.max(0, Math.min(discountAmount, subtotal));
};

const getWardByName = async (name, client = db) => {
    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
        return null;
    }

    const result = await client.query(
        `
            SELECT id, name, shipping_fee
            FROM wards
            WHERE name = $1
            LIMIT 1
        `,
        [normalizedName]
    );

    return result.rows[0] || null;
};

const createOrderStatusHistory = async (orderId, fromStatus, toStatus, changedBy = null, note = null) => {
    const query = `
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `;
    const result = await db.query(query, [orderId, fromStatus, toStatus, changedBy, note]);
    return result.rows[0];
};

const getOrderStatusHistoryByOrderId = async (orderId) => {
    const query = `
        SELECT osh.*, u.username, u.full_name
        FROM order_status_history osh
        LEFT JOIN users u ON osh.changed_by = u.id
        WHERE osh.order_id = $1
        ORDER BY osh.created_at ASC, osh.id ASC
    `;
    const result = await db.query(query, [orderId]);
    return result.rows;
};

const getOrderReviewByOrderId = async (orderId) => {
    const query = `
        SELECT id, order_id, customer_id, rating, content, created_at, updated_at
        FROM order_reviews
        WHERE order_id = $1
        LIMIT 1
    `;
    const result = await db.query(query, [orderId]);
    return result.rows[0] || null;
};

const getOrderReviewItemsByOrderId = async (orderId) => {
    const query = `
        SELECT
            ori.menu_item_id,
            ori.rating,
            mi.name AS menu_item_name
        FROM order_review_items ori
        JOIN menu_items mi ON mi.id = ori.menu_item_id
        WHERE ori.order_id = $1
        ORDER BY mi.name ASC
    `;
    const result = await db.query(query, [orderId]);
    return result.rows;
};

const applySoldCountDeltaByOrder = async (orderId, delta, client = db) => {
    const safeDelta = Number(delta);

    if (!Number.isInteger(safeDelta) || safeDelta === 0) {
        return;
    }

    await client.query(
        `
            UPDATE menu_items mi
            SET sold_count = GREATEST(0, COALESCE(mi.sold_count, 0) + src.delta_quantity)
            FROM (
                SELECT
                    oi.menu_item_id,
                    (SUM(oi.quantity)::int * $2) AS delta_quantity
                FROM order_items oi
                WHERE oi.order_id = $1
                GROUP BY oi.menu_item_id
            ) src
            WHERE mi.id = src.menu_item_id
        `,
        [orderId, safeDelta]
    );
};

const getAllOrders = async ({ search = "", status = "all", sortBy = "created_at", sortDir = "desc", page = 1, limit = 5 } = {}) => {
    const params = [];
    const conditions = ["o.status <> 'cart'"];

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    let fromWhere = `
        FROM orders o
    `;

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(o.order_code ILIKE $${params.length} OR o.delivery_full_name ILIKE $${params.length})`);
    }

    if (["pending", "confirmed", "preparing", "shipping", "completed", "cancelled"].includes(status)) {
        params.push(status);
        conditions.push(`o.status = $${params.length}`);
    }

    fromWhere += ` WHERE ${conditions.join(" AND ")}`;

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, params);
    const totalItems = countResult.rows[0]?.total || 0;

    const sortMap = {
        created_at: "o.created_at",
        total_amount: "o.total_amount",
        delivery_full_name: "o.delivery_full_name"
    };
    const safeSortBy = sortMap[sortBy] || "o.created_at";
    const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    params.push(safeLimit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const query = `
        SELECT o.order_code, o.delivery_full_name, o.delivery_phone, o.delivery_address,
               o.total_amount, o.status, o.created_at, o.updated_at
        ${fromWhere}
        ORDER BY ${safeSortBy} ${safeSortDir}
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await db.query(query, params);
    return {
        data: result.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems,
            totalPages: Math.max(1, Math.ceil(totalItems / safeLimit))
        }
    };
};

const getOrdersByCustomerId = async (customerId, { search = "", status = "all", page = 1, limit = 8 } = {}) => {
    const params = [customerId];
    const conditions = ["o.customer_id = $1", "o.status <> 'cart'"];

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 50) : 8;
    const offset = (safePage - 1) * safeLimit;

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(o.order_code ILIKE $${params.length} OR o.delivery_full_name ILIKE $${params.length} OR o.delivery_phone ILIKE $${params.length})`);
    }

    if (["pending", "confirmed", "preparing", "shipping", "completed", "cancelled"].includes(status)) {
        params.push(status);
        conditions.push(`o.status = $${params.length}`);
    }

    const fromWhere = `
        FROM orders o
        LEFT JOIN order_reviews r ON r.order_id = o.id
        WHERE ${conditions.join(" AND ")}
    `;

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, params);
    const totalItems = countResult.rows[0]?.total || 0;

    params.push(safeLimit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const query = `
        SELECT o.order_code, o.delivery_full_name, o.delivery_phone, o.delivery_address,
               o.total_amount, o.status, o.created_at,
               CASE WHEN r.id IS NOT NULL THEN TRUE ELSE FALSE END AS has_review
        ${fromWhere}
        ORDER BY o.created_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const result = await db.query(query, params);

    return {
        data: result.rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems,
            totalPages: Math.max(1, Math.ceil(totalItems / safeLimit))
        }
    };
};

const generateOrderCode = () => {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000);
    return `ORD${y}${m}${d}-${random}`;
};

const createOrUpdateOrder = async (customerId, orderData) => {
    try {
        await db.query("BEGIN");

        const defaultAddressResult = await db.query(
            `SELECT ca.address_line, w.name AS ward_name, w.shipping_fee
             FROM customer_addresses ca
             JOIN wards w ON w.id = ca.ward_id
             WHERE ca.customer_id = $1 AND ca.is_default = TRUE
             LIMIT 1`,
            [customerId]
        );

        if (defaultAddressResult.rowCount === 0) {
            throw new Error("DEFAULT_ADDRESS_REQUIRED");
        }

        const defaultAddress = defaultAddressResult.rows[0];
        const shippingFee = Number(defaultAddress.shipping_fee || 0);

        const existingOrderRes = await db.query(
            "SELECT id FROM orders WHERE customer_id=$1 AND status='cart' LIMIT 1",
            [customerId]
        );

        let orderId;
        let orderCode;
        let subtotal = orderData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        let totalAmount = subtotal + shippingFee - (orderData.discountAmount || 0);

        if (existingOrderRes.rowCount > 0) {
            orderId = existingOrderRes.rows[0].id;
            await db.query(
                `UPDATE orders SET delivery_full_name=$1, delivery_phone=$2, delivery_address=$3,
         delivery_ward_name=$4, shipping_fee=$5, subtotal=$6, discount_amount=$7, total_amount=$8, notes=$9,
         updated_at=CURRENT_TIMESTAMP
         WHERE id=$10`,
                [
                    orderData.deliveryFullName,
                    orderData.deliveryPhone,
                    defaultAddress.address_line,
                    defaultAddress.ward_name,
                    shippingFee,
                    subtotal,
                    orderData.discountAmount || 0,
                    totalAmount,
                    orderData.notes || null,
                    orderId
                ]
            );

            await db.query(`DELETE FROM order_items WHERE order_id=$1`, [orderId]);

            orderCode = (await db.query("SELECT order_code FROM orders WHERE id=$1", [orderId])).rows[0].order_code;
        } else {
            orderCode = generateOrderCode();
            const orderResult = await db.query(
                `INSERT INTO orders (order_code, customer_id, delivery_full_name, delivery_phone, delivery_address,
         delivery_ward_name, shipping_fee, subtotal, discount_amount, total_amount, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'cart') RETURNING id`,
                [
                    orderCode,
                    customerId,
                    orderData.deliveryFullName,
                    orderData.deliveryPhone,
                    defaultAddress.address_line,
                    defaultAddress.ward_name,
                    shippingFee,
                    subtotal,
                    orderData.discountAmount || 0,
                    totalAmount,
                    orderData.notes || null
                ]
            );
            orderId = orderResult.rows[0].id;

            await createOrderStatusHistory(orderId, null, 'cart', null, null);
        }

        const itemQuery = `INSERT INTO order_items (order_id, menu_item_id, quantity, price, note)
                       VALUES ($1,$2,$3,$4,$5)`;
        for (const item of orderData.items) {
            await db.query(itemQuery, [
                orderId,
                item.menu_item_id,
                item.quantity,
                item.price,
                item.note || null
            ]);
        }

        await db.query("COMMIT");

        return { orderId, orderCode, totalAmount };
    } catch (err) {
        await db.query("ROLLBACK");
        console.error("Error in createOrUpdateOrder:", err);
        throw err;
    }
};

const confirmOrder = async (orderCode, orderData, paymentMethod) => {
    try {
        await db.query("BEGIN");

        const currentOrderResult = await db.query(
            `SELECT id, status, customer_id FROM orders WHERE order_code = $1 FOR UPDATE`,
            [orderCode]
        );

        if (currentOrderResult.rowCount === 0) {
            throw new Error('Order not found');
        }

        const currentOrder = currentOrderResult.rows[0];

        if (currentOrder.status !== 'cart') {
            throw new Error("ORDER_NOT_IN_CART");
        }

        // Lấy rank khách hàng để lọc khuyến mãi
        let customerRank = 'normal';
        if (currentOrder.customer_id) {
            const rankResult = await db.query(
                `SELECT rank FROM customers WHERE id = $1`,
                [currentOrder.customer_id]
            );
            customerRank = rankResult.rows[0]?.rank || 'normal';
        }

        const selectedWard = await getWardByName(orderData.delivery_ward_name, db);

        if (!selectedWard) {
            throw new Error("INVALID_DELIVERY_WARD");
        }

        const subtotal = Math.max(0, toSafeNumber(orderData.subtotal, 0));
        const shippingFee = Math.max(0, toSafeNumber(selectedWard.shipping_fee, 0));
        const voucherId = orderData.voucher_id ? Number(orderData.voucher_id) : null;

        // Lấy danh sách order items để tính khuyến mãi
        const orderItemsResult = await db.query(
            `SELECT oi.id AS order_item_id, oi.menu_item_id, oi.quantity, oi.price
             FROM order_items oi WHERE oi.order_id = $1`,
            [currentOrder.id]
        );
        const orderItems = orderItemsResult.rows;

        // Tính khuyến mãi tự động cho từng item
        let promotionDiscount = 0;
        const menuItemIds = orderItems.map(oi => oi.menu_item_id);

        if (menuItemIds.length > 0) {
            const promoResult = await db.query(`
                SELECT DISTINCT ON (src.mi_id)
                    p.id AS promotion_id,
                    p.name AS promotion_name,
                    p.discount_percent,
                    p.discount_amount,
                    src.mi_id AS menu_item_id
                FROM promotions p
                JOIN LATERAL (
                    SELECT pmi.menu_item_id AS mi_id
                    FROM promotion_menu_items pmi
                    WHERE pmi.promotion_id = p.id AND pmi.menu_item_id = ANY($1)
                    UNION
                    SELECT mi.id AS mi_id
                    FROM promotion_categories pc
                    JOIN menu_items mi ON mi.category_id = pc.category_id
                    WHERE pc.promotion_id = p.id AND mi.id = ANY($1)
                    UNION
                    SELECT mi.id AS mi_id
                    FROM promotion_menu_types pmt
                    JOIN categories cat ON cat.menu_type_id = pmt.menu_type_id
                    JOIN menu_items mi ON mi.category_id = cat.id
                    WHERE pmt.promotion_id = p.id AND mi.id = ANY($1)
                ) src ON TRUE
                WHERE p.is_active = TRUE
                  AND p.start_time <= NOW()
                  AND p.end_time >= NOW()
                  AND (p.applicable_rank = 'all' OR p.applicable_rank = $2)
                ORDER BY src.mi_id, p.id
            `, [menuItemIds, customerRank]);

            // Gom tất cả promotion theo từng item
            const promoGroups = {};
            for (const row of promoResult.rows) {
                const id = row.menu_item_id;
                if (!promoGroups[id]) promoGroups[id] = [];
                promoGroups[id].push(row);
            }

            // Chọn promotion có lợi nhất (giảm nhiều nhất) cho mỗi item
            const promoMap = {};
            for (const oi of orderItems) {
                const candidates = promoGroups[oi.menu_item_id];
                if (!candidates || candidates.length === 0) continue;
                const unitPrice = Number(oi.price);
                promoMap[oi.menu_item_id] = candidates.reduce((best, promo) => {
                    const discountOf = (p) => p.discount_percent
                        ? unitPrice * Number(p.discount_percent) / 100
                        : Math.min(Number(p.discount_amount ?? 0), unitPrice);
                    return discountOf(promo) > discountOf(best) ? promo : best;
                });
            }

            // Xóa promotion cũ nếu có
            const orderItemIdList = orderItems.map(oi => oi.order_item_id);
            if (orderItemIdList.length > 0) {
                await db.query(
                    `DELETE FROM order_item_promotions WHERE order_item_id = ANY($1)`,
                    [orderItemIdList]
                );
            }

            for (const oi of orderItems) {
                const promo = promoMap[oi.menu_item_id];
                if (!promo) continue;

                let itemDiscount = 0;
                const itemTotal = Number(oi.price) * Number(oi.quantity);

                if (promo.discount_percent) {
                    itemDiscount = Math.round(itemTotal * Number(promo.discount_percent) / 100);
                } else if (promo.discount_amount) {
                    itemDiscount = Math.min(Number(promo.discount_amount) * Number(oi.quantity), itemTotal);
                }

                if (itemDiscount > 0) {
                    promotionDiscount += itemDiscount;

                    await db.query(`
                        INSERT INTO order_item_promotions
                        (order_item_id, promotion_id, promotion_name, discount_percent, discount_amount)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [
                        oi.order_item_id,
                        promo.promotion_id,
                        promo.promotion_name,
                        promo.discount_percent || null,
                        itemDiscount
                    ]);
                }
            }
        }

        let voucherDiscount = 0;
        let appliedVoucher = null;

        if (voucherId) {
            appliedVoucher = await getVoucherForUpdate(voucherId, db);

            if (!appliedVoucher) {
                throw new Error("VOUCHER_NOT_FOUND");
            }

            let customerVoucherUsed = 0;
            if (appliedVoucher.max_usage_per_customer !== null && currentOrder.customer_id) {
                const usageResult = await db.query(
                    `SELECT used_count FROM customer_voucher_usage WHERE customer_id = $1 AND voucher_id = $2`,
                    [currentOrder.customer_id, voucherId]
                );
                customerVoucherUsed = usageResult.rows[0]?.used_count || 0;
            }

            voucherDiscount = calculateVoucherDiscount(appliedVoucher, subtotal - promotionDiscount, customerVoucherUsed);
        }

        const discountAmount = promotionDiscount + voucherDiscount;
        const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

        const orderQuery = `UPDATE orders SET status='pending', delivery_full_name=$1, delivery_phone=$2, delivery_address=$3,
            delivery_ward_name=$4, shipping_fee=$5, subtotal=$6, discount_amount=$7, total_amount=$8, notes=$9,
            created_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE order_code=$10 RETURNING id, order_code`;
        const orderResult = await db.query(orderQuery, [
            orderData.delivery_full_name,
            orderData.delivery_phone,
            orderData.delivery_address,
            selectedWard.name,
            shippingFee,
            subtotal,
            discountAmount,
            totalAmount,
            orderData.notes,
            orderCode
        ]);

        const orderId = orderResult.rows[0].id;

        if (voucherId) {
            await db.query(
                `
                    INSERT INTO order_vouchers (order_id, voucher_id)
                    VALUES ($1, $2)
                    ON CONFLICT (order_id)
                    DO UPDATE SET voucher_id = EXCLUDED.voucher_id
                `,
                [orderId, voucherId]
            );

            await db.query(
                `
                    UPDATE vouchers
                    SET used_count = used_count + 1
                    WHERE id = $1
                `,
                [voucherId]
            );

            if (currentOrder.customer_id) {
                await db.query(
                    `
                        INSERT INTO customer_voucher_usage (customer_id, voucher_id, used_count)
                        VALUES ($1, $2, 1)
                        ON CONFLICT (customer_id, voucher_id)
                        DO UPDATE SET used_count = customer_voucher_usage.used_count + 1
                    `,
                    [currentOrder.customer_id, voucherId]
                );
            }
        } else {
            await db.query(`DELETE FROM order_vouchers WHERE order_id = $1`, [orderId]);
        }

        const paymentResult = await createPayment(orderId, paymentMethod, totalAmount);
        await createOrderStatusHistory(orderId, currentOrder.status, 'pending', null, null);

        await db.query("COMMIT");

        return {
            orderId,
            paymentId: paymentResult.id,
            discountAmount,
            promotionDiscount,
            voucherDiscount,
            totalAmount,
            voucherCode: appliedVoucher?.code || null
        };
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const getOrderByOrderCode = async (orderCode) => {
    const orderQuery = `
        SELECT o.id, o.order_code, o.customer_id, o.delivery_full_name, o.delivery_phone, o.delivery_address,
                o.delivery_ward_name, o.shipping_fee, o.subtotal, o.discount_amount, o.total_amount, o.status, o.notes,
                o.created_at, o.updated_at, ov.voucher_id, v.code AS voucher_code,
                json_agg(json_build_object(
                    'menu_item_id', oi.menu_item_id,
                    'name', mi.name,
                    'quantity', oi.quantity,
                    'price', oi.price,
                    'note', oi.note
                )) AS items
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        LEFT JOIN order_vouchers ov ON ov.order_id = o.id
        LEFT JOIN vouchers v ON v.id = ov.voucher_id
        WHERE o.order_code = $1
        GROUP BY o.id, ov.voucher_id, v.code
    `;

    const result = await db.query(orderQuery, [orderCode]);
    const order = result.rows[0];
    if (order) {
        const payment = await getPaymentByOrderId(order.id);
        const statusHistory = await getOrderStatusHistoryByOrderId(order.id);
        const review = await getOrderReviewByOrderId(order.id);
        const reviewItems = review ? await getOrderReviewItemsByOrderId(order.id) : [];

        const promoResult = await db.query(
            `SELECT oip.order_item_id, oip.promotion_name, oip.discount_percent, oip.discount_amount,
                    oi.menu_item_id
             FROM order_item_promotions oip
             JOIN order_items oi ON oi.id = oip.order_item_id
             WHERE oi.order_id = $1`,
            [order.id]
        );
        const promoMap = {};
        for (const row of promoResult.rows) {
            promoMap[row.menu_item_id] = {
                promotion_name: row.promotion_name,
                discount_percent: row.discount_percent,
                discount_amount: row.discount_amount
            };
        }
        if (order.items) {
            order.items = order.items.map(item => ({
                ...item,
                promotion: promoMap[item.menu_item_id] || null
            }));
        }

        order.payment = payment;
        order.status_history = statusHistory;
        order.review = review
            ? {
                ...review,
                items: reviewItems
            }
            : null;
    }
    return order;
};

const submitOrderReview = async (orderCode, customerId, content, itemRatings) => {
    try {
        await db.query("BEGIN");

        const orderResult = await db.query(
            `
                SELECT id, status, customer_id
                FROM orders
                WHERE order_code = $1
                FOR UPDATE
            `,
            [orderCode]
        );

        if (orderResult.rowCount === 0 || Number(orderResult.rows[0].customer_id) !== Number(customerId)) {
            throw new Error("ORDER_NOT_FOUND_OR_FORBIDDEN");
        }

        const order = orderResult.rows[0];

        if (order.status !== "completed") {
            throw new Error("ORDER_NOT_COMPLETED");
        }

        const orderItemsResult = await db.query(
            `
                SELECT DISTINCT menu_item_id
                FROM order_items
                WHERE order_id = $1
            `,
            [order.id]
        );
        const orderMenuItemIds = new Set(orderItemsResult.rows.map((row) => Number(row.menu_item_id)));

        if (!Array.isArray(itemRatings) || itemRatings.length === 0) {
            throw new Error("INVALID_ITEM_RATINGS");
        }

        const normalizedMap = new Map();

        for (const item of itemRatings) {
            const menuItemId = Number(item?.menuItemId);
            const itemRating = Number(item?.rating);

            if (!Number.isInteger(menuItemId) || !orderMenuItemIds.has(menuItemId)) {
                throw new Error("INVALID_ITEM_RATINGS");
            }

            if (!Number.isInteger(itemRating) || itemRating < 1 || itemRating > 5) {
                throw new Error("INVALID_ITEM_RATING_VALUE");
            }

            normalizedMap.set(menuItemId, itemRating);
        }

        for (const menuItemId of orderMenuItemIds) {
            if (!normalizedMap.has(menuItemId)) {
                throw new Error("MISSING_ITEM_RATING");
            }
        }

        const normalizedRatings = Array.from(normalizedMap.entries()).map(([menuItemId, itemRating]) => ({
            menuItemId,
            rating: itemRating
        }));

        const averageRating = normalizedRatings.reduce((sum, row) => sum + row.rating, 0) / normalizedRatings.length;
        const roundedAverage = Number(averageRating.toFixed(2));

        const reviewResult = await db.query(
            `
                INSERT INTO order_reviews (order_id, customer_id, rating, content)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (order_id)
                DO UPDATE
                SET rating = EXCLUDED.rating,
                    content = EXCLUDED.content,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id, order_id, customer_id, rating, content, created_at, updated_at
            `,
            [order.id, customerId, roundedAverage, content]
        );

        await db.query(`DELETE FROM order_review_items WHERE order_id = $1`, [order.id]);

        const insertReviewItemQuery = `
            INSERT INTO order_review_items (order_id, menu_item_id, rating)
            VALUES ($1, $2, $3)
            ON CONFLICT (order_id, menu_item_id)
            DO UPDATE SET rating = EXCLUDED.rating
        `;

        for (const row of normalizedRatings) {
            await db.query(insertReviewItemQuery, [order.id, row.menuItemId, row.rating]);
        }

        const reviewItems = await getOrderReviewItemsByOrderId(order.id);

        await db.query("COMMIT");
        return {
            ...reviewResult.rows[0],
            items: reviewItems
        };
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const cancelOrder = async (orderCode, customerId, refundInfo = null) => {
    try {
        await db.query("BEGIN");

        const currentOrderResult = await db.query(
            `SELECT id, customer_id, status FROM orders WHERE order_code = $1 FOR UPDATE`,
            [orderCode]
        );

        if (currentOrderResult.rowCount === 0) {
            throw new Error("ORDER_NOT_FOUND");
        }

        const currentOrder = currentOrderResult.rows[0];

        if (Number(currentOrder.customer_id) !== Number(customerId)) {
            throw new Error("FORBIDDEN_ORDER_ACCESS");
        }

        if (!['pending', 'confirmed'].includes(currentOrder.status)) {
            throw new Error("ORDER_NOT_CANCELLABLE");
        }

        const query = `UPDATE orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE order_code=$1 RETURNING id`;
        const result = await db.query(query, [orderCode]);

        if (result.rowCount > 0) {
            const payment = await getPaymentByOrderId(result.rows[0].id, db);

            const requiresRefundInfo =
                (payment?.method === 'vnpay' || payment?.method === 'transfer') &&
                payment?.payment_status === 'paid';

            if (requiresRefundInfo) {
                if (!refundInfo) {
                    throw new Error("REFUND_INFO_REQUIRED");
                }

                const normalizedBankName = String(refundInfo.bankName || '').trim();
                const normalizedAccountNumber = String(refundInfo.accountNumber || '').trim();
                const normalizedAccountName = String(refundInfo.accountName || '').trim();
                const normalizedNote = String(refundInfo.note || '').trim();

                if (!normalizedBankName || !normalizedAccountNumber || !normalizedAccountName) {
                    throw new Error("REFUND_INFO_REQUIRED");
                }

                await saveRefundRequestInfo(
                    result.rows[0].id,
                    {
                        bankName: normalizedBankName,
                        accountNumber: normalizedAccountNumber,
                        accountName: normalizedAccountName,
                        note: normalizedNote
                    },
                    db
                );
            } else {
                await markOrderPaymentFailed(result.rows[0].id, db);
            }

            await createOrderStatusHistory(result.rows[0].id, currentOrder.status, 'cancelled', null, 'Khách hàng hủy đơn');
            await db.query("COMMIT");
            return {
                orderId: result.rows[0].id,
                refundRequired: requiresRefundInfo
            };
        }

        throw new Error("CANCEL_FAILED");
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const getDeliveryHistoryByShipperId = async (shipperId) => {
    const query = `
        SELECT o.order_code, o.delivery_full_name, o.delivery_phone,
               o.delivery_address, o.delivery_ward_name,
               o.total_amount, o.status, o.notes, o.created_at, o.updated_at
        FROM orders o
        WHERE o.shipper_id = $1
          AND o.status IN ('completed', 'cancelled')
        ORDER BY o.updated_at DESC, o.created_at DESC
    `;
    const result = await db.query(query, [shipperId]);
    return result.rows;
};

const updateOrderStatus = async (orderCode, status, changedBy = null, note = null, shipperId = null) => {
    try {
        await db.query("BEGIN");

        const currentOrderResult = await db.query(
            `SELECT id, status FROM orders WHERE order_code = $1 FOR UPDATE`,
            [orderCode]
        );

        if (currentOrderResult.rowCount === 0) {
            await db.query("ROLLBACK");
            return null;
        }

        const currentOrder = currentOrderResult.rows[0];

        const setClauses = ["status=$1", "updated_at=CURRENT_TIMESTAMP"];
        const params = [status];

        if (status === 'shipping' && shipperId) {
            params.push(shipperId);
            setClauses.push(`shipper_id=$${params.length}`);
        }

        params.push(orderCode);
        const query = `
            UPDATE orders
            SET ${setClauses.join(", ")}
            WHERE order_code=$${params.length}
            RETURNING id, order_code, status
        `;

        const result = await db.query(query, params);

        if (result.rows[0]) {
            if (status === 'completed') {
                await markCashPaymentPaid(result.rows[0].id, db);
                await applySoldCountDeltaByOrder(result.rows[0].id, 1, db);
            } else if (status === 'cancelled') {
                const payment = await getPaymentByOrderId(result.rows[0].id, db);
                if ((payment?.method === 'vnpay' || payment?.method === 'transfer') && payment.payment_status === 'paid') {
                    await markOrderPaymentRefunded(result.rows[0].id, db);
                } else {
                    await markOrderPaymentFailed(result.rows[0].id, db);
                }
            }

            await createOrderStatusHistory(result.rows[0].id, currentOrder.status, status, changedBy, note);
        }

        await db.query("COMMIT");
        return result.rows[0] || null;
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const getShippers = async () => {
    const query = `
        SELECT id, username, full_name, phone_number
        FROM users
        WHERE role = 'shipper' AND is_active = TRUE
        ORDER BY full_name ASC
    `;
    const result = await db.query(query);
    return result.rows;
};

const getOrdersByShipperId = async (shipperId) => {
    const query = `
        SELECT o.order_code, o.delivery_full_name, o.delivery_phone,
               o.delivery_address, o.delivery_ward_name,
               o.total_amount, o.status, o.notes, o.created_at
        FROM orders o
        WHERE o.shipper_id = $1 AND o.status = 'shipping'
        ORDER BY o.created_at ASC
    `;
    const result = await db.query(query, [shipperId]);
    return result.rows;
};

const completeDelivery = async (orderCode, shipperId) => {
    try {
        await db.query("BEGIN");

        const check = await db.query(
            `SELECT id, status, shipper_id FROM orders WHERE order_code = $1 FOR UPDATE`,
            [orderCode]
        );

        if (check.rowCount === 0) throw new Error('ORDER_NOT_FOUND');
        const order = check.rows[0];

        if (order.status !== 'shipping') throw new Error('ORDER_NOT_SHIPPING');
        if (order.shipper_id !== shipperId) throw new Error('NOT_ASSIGNED');

        const result = await db.query(
            `UPDATE orders SET status='completed', updated_at=CURRENT_TIMESTAMP
             WHERE order_code=$1 RETURNING id, order_code, status`,
            [orderCode]
        );

        await markCashPaymentPaid(result.rows[0].id, db);
        await applySoldCountDeltaByOrder(result.rows[0].id, 1, db);
        await createOrderStatusHistory(result.rows[0].id, 'shipping', 'completed', shipperId, null);

        await db.query("COMMIT");
        return result.rows[0];
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const cancelDeliveryByShipper = async (orderCode, shipperId, reason) => {
    try {
        await db.query("BEGIN");

        const check = await db.query(
            `SELECT id, status, shipper_id FROM orders WHERE order_code = $1 FOR UPDATE`,
            [orderCode]
        );

        if (check.rowCount === 0) throw new Error('ORDER_NOT_FOUND');
        const order = check.rows[0];

        if (order.status !== 'shipping') throw new Error('ORDER_NOT_SHIPPING');
        if (order.shipper_id !== shipperId) throw new Error('NOT_ASSIGNED');

        const result = await db.query(
            `UPDATE orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP
             WHERE order_code=$1 RETURNING id, order_code, status`,
            [orderCode]
        );

        const payment = await getPaymentByOrderId(result.rows[0].id, db);
        if ((payment?.method === 'vnpay' || payment?.method === 'transfer') && payment.payment_status === 'paid') {
            await markOrderPaymentRefunded(result.rows[0].id, db);
        } else {
            await markOrderPaymentFailed(result.rows[0].id, db);
        }

        await createOrderStatusHistory(result.rows[0].id, 'shipping', 'cancelled', shipperId, reason || 'Shipper hủy đơn');

        await db.query("COMMIT");
        return result.rows[0];
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const getOrderItemsForReorder = async (orderCode, customerId) => {
    const result = await db.query(
        `
            SELECT oi.menu_item_id, oi.quantity, oi.note
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN menu_items mi ON mi.id = oi.menu_item_id
            WHERE o.order_code = $1
              AND o.customer_id = $2
              AND o.status IN ('completed', 'cancelled')
              AND mi.is_available = true
        `,
        [orderCode, customerId]
    );
    return result.rows;
};

const getOrderPredictionInputs = async (orderCode) => {
    const result = await db.query(
        `
            SELECT
                o.order_code,
                o.customer_id,
                o.delivery_ward_name AS ward_name,
                o.subtotal,
                EXTRACT(HOUR FROM o.created_at)::INT AS order_hour,
                ((EXTRACT(DOW FROM o.created_at)::INT + 6) % 7) AS day_of_week,
                COALESCE(SUM(oi.quantity), 1)::INT AS total_items,
                COALESCE(COUNT(DISTINCT oi.menu_item_id), 1)::INT AS num_distinct
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE o.order_code = $1
            GROUP BY o.id
            LIMIT 1
        `,
        [orderCode]
    );

    return result.rows[0] || null;
};

module.exports = {
    getAllOrders,
    getOrdersByCustomerId,
    createOrUpdateOrder,
    getOrderByOrderCode,
    submitOrderReview,
    confirmOrder,
    cancelOrder,
    updateOrderStatus,
    getShippers,
    getOrdersByShipperId,
    getDeliveryHistoryByShipperId,
    completeDelivery,
    cancelDeliveryByShipper,
    getOrderItemsForReorder,
    getOrderPredictionInputs
};