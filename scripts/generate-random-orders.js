require("dotenv").config();

const db = require("../src/config/db");

/* ---------- Ward distance tiers (from Ninh Kiều) ---------- */
// Tier 0: Ninh Kiều (restaurant location)
// Tier 1: Tân An, Cái Khế (closest)
// Tier 2: Bình Thủy, Cái Răng
// Tier 3: Long Tuyền, An Bình, Thới An Đông (farthest)
const WARD_DISTANCE_TIER = {
    "Ninh Kiều": 0,
    "Tân An": 1,
    "Cái Khế": 1,
    "Bình Thủy": 2,
    "Cái Răng": 2,
    "Long Tuyền": 3,
    "An Bình": 3,
    "Thới An Đông": 3
};

/* Base delivery time (minutes) by ward tier */
const BASE_DELIVERY_MINUTES = {
    0: [10, 20],   // Ninh Kiều: 10-20 mins
    1: [15, 30],   // Tân An, Cái Khế: 15-30 mins
    2: [25, 45],   // Bình Thủy, Cái Răng: 25-45 mins
    3: [35, 60]    // Long Tuyền, An Bình, Thới An Đông: 35-60 mins
};

/* Peak hour ranges (11h-13h lunch, 17h30-20h dinner) */
const isPeakHour = (date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    const timeVal = h + m / 60;
    return (timeVal >= 11 && timeVal <= 13) || (timeVal >= 17.5 && timeVal <= 20);
};

const ORDER_STATUSES = [
    { name: "pending", weight: 8 },
    { name: "confirmed", weight: 8 },
    { name: "preparing", weight: 10 },
    { name: "shipping", weight: 12 },
    { name: "completed", weight: 52 },
    { name: "cancelled", weight: 10 }
];

const ORDER_NOTES = [
    null, null, null,
    "Giao giờ trưa",
    "Gọi trước khi giao",
    "Không lấy muỗng đũa",
    "Để trước cửa giúp mình",
    "Món nóng giúp mình"
];

const ITEM_NOTES = [
    null, null, null,
    "Ít cay",
    "Không hành",
    "Thêm nước chấm",
    "Nhiều rau",
    "Ít ngọt"
];

const RANK_THRESHOLD = 10_000_000;

/* ---------- utility ---------- */

const parseArgs = (argv) => {
    const options = { count: 100, from: null, to: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === "--count") { options.count = Number(argv[++i]); }
        else if (t === "--from") { options.from = argv[++i]; }
        else if (t === "--to") { options.to = argv[++i]; }
        else if (t === "--dry-run") { options.dryRun = true; }
    }
    return options;
};

const assertValidOptions = ({ count, from, to }) => {
    if (!Number.isInteger(count) || count <= 0) throw new Error("COUNT_MUST_BE_POSITIVE_INTEGER");
    if (!from || !to) throw new Error("FROM_AND_TO_ARE_REQUIRED");
    const fromDate = new Date(`${from}T00:00:00.000`);
    const toDate = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) throw new Error("INVALID_DATE_RANGE");
    if (fromDate > toDate) throw new Error("FROM_MUST_BE_BEFORE_TO");
    return { fromDate, toDate };
};

const randomInt = (min, max) => Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
const pickOne = (items) => items[randomInt(0, items.length - 1)];
const pickWeighted = (items) => {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let c = Math.random() * total;
    for (const i of items) { c -= i.weight; if (c <= 0) return i.name; }
    return items[items.length - 1].name;
};

const addMinutes = (d, m) => new Date(d.getTime() + m * 60_000);

const formatDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
};

/**
 * Generate a random timestamp between fromDate and toDate,
 * constrained to restaurant open hours (6:00 - 22:00).
 * We pick a random day first, then a random time in 6:00-21:30
 * (latest order at 21:30 so delivery finishes before closing).
 */
const randomOrderTimestamp = (fromDate, toDate) => {
    const fromDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const toDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    const totalDays = Math.round((toDay - fromDay) / 86_400_000);

    const dayOffset = randomInt(0, totalDays);
    const orderDay = new Date(fromDay.getTime() + dayOffset * 86_400_000);

    // Random time between 06:00 and 21:30 (latest order at 21:30)
    const minuteOfDay = randomInt(6 * 60, 21 * 60 + 30);
    orderDay.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, randomInt(0, 59), randomInt(0, 999));
    return orderDay;
};

const buildOrderCodeFactory = (existingCodes) => {
    let serial = 1;
    return (createdAt) => {
        let code;
        do {
            code = `ORD${formatDateKey(createdAt)}-${String(serial).padStart(5, "0")}`;
            serial++;
        } while (existingCodes.has(code));
        existingCodes.add(code);
        return code;
    };
};

/* ---------- delivery time calculation ---------- */

/**
 * Compute realistic delivery duration in minutes based on:
 *  - ward distance tier (0-3)
 *  - item count in the order
 *  - whether it's a peak hour
 */
const computeDeliveryMinutes = (wardName, itemCount, orderTime) => {
    const tier = WARD_DISTANCE_TIER[wardName] ?? 2;
    const [baseMin, baseMax] = BASE_DELIVERY_MINUTES[tier] || [20, 40];

    // Base delivery time
    let deliveryMin = randomInt(baseMin, baseMax);

    // Extra time for many items (preparation takes longer)
    // 1-2 items: no extra, 3-4 items: +5-10 min, 5+ items: +10-20 min
    if (itemCount >= 5) deliveryMin += randomInt(10, 20);
    else if (itemCount >= 3) deliveryMin += randomInt(5, 10);

    // Peak hour penalty: +5-15 minutes
    if (isPeakHour(orderTime)) deliveryMin += randomInt(5, 15);

    return deliveryMin;
};

/* ---------- menu item sampling ---------- */

const sampleMenuItems = (menuItems) => {
    const count = randomInt(1, Math.min(6, menuItems.length));
    const shuffled = [...menuItems].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map((item) => ({
        menu_item_id: item.id,
        quantity: randomInt(1, 3),
        price: Number(item.price),
        note: pickOne(ITEM_NOTES)
    }));
};

/* ---------- payment (all cash) ---------- */

const buildPaymentState = ({ status, createdAt, updatedAt }) => {
    // All payments are cash
    if (status === "completed") {
        return { payment_status: "paid", paid_at: updatedAt, refund_marked_at: null };
    }
    if (status === "cancelled") {
        return { payment_status: "failed", paid_at: null, refund_marked_at: null };
    }
    // pending, confirmed, preparing, shipping – cash not yet paid
    return { payment_status: "pending", paid_at: null, refund_marked_at: null };
};

/* ---------- status history with realistic timing ---------- */

const buildStatusHistory = ({ orderId, status, shipperId, createdAt, deliveryMinutes }) => {
    const history = [];

    // cart -> pending (customer places order)
    const pendingAt = addMinutes(createdAt, 1);
    history.push({ order_id: orderId, from_status: null, to_status: "cart", changed_by: null, note: null, created_at: createdAt });
    history.push({ order_id: orderId, from_status: "cart", to_status: "pending", changed_by: null, note: null, created_at: pendingAt });

    if (status === "pending") return history;

    // pending -> confirmed (admin confirms, 3-15 min after pending)
    const confirmedAt = addMinutes(pendingAt, randomInt(3, 15));
    history.push({ order_id: orderId, from_status: "pending", to_status: "confirmed", changed_by: null, note: null, created_at: confirmedAt });

    if (status === "confirmed") return history;

    if (status === "cancelled") {
        const cancelFrom = Math.random() < 0.5 ? "pending" : "confirmed";
        const baseTime = cancelFrom === "pending" ? pendingAt : confirmedAt;
        const filtered = cancelFrom === "pending"
            ? history.filter((e) => e.to_status !== "confirmed")
            : history;
        return filtered.concat({
            order_id: orderId,
            from_status: cancelFrom,
            to_status: "cancelled",
            changed_by: null,
            note: "Khách hủy đơn",
            created_at: addMinutes(baseTime, randomInt(5, 30))
        });
    }

    // confirmed -> preparing (kitchen starts, 5-15 min after confirmed)
    const preparingAt = addMinutes(confirmedAt, randomInt(5, 15));
    history.push({ order_id: orderId, from_status: "confirmed", to_status: "preparing", changed_by: null, note: null, created_at: preparingAt });

    if (status === "preparing") return history;

    // preparing -> shipping (food ready, preparation takes ~30-60% of delivery time)
    const prepDuration = Math.round(deliveryMinutes * (0.3 + Math.random() * 0.3));
    const shippingAt = addMinutes(preparingAt, Math.max(10, prepDuration));
    history.push({ order_id: orderId, from_status: "preparing", to_status: "shipping", changed_by: shipperId || null, note: null, created_at: shippingAt });

    if (status === "shipping") return history;

    // shipping -> completed (delivery takes remaining time)
    const transitDuration = Math.max(10, deliveryMinutes - prepDuration);
    const completedAt = addMinutes(shippingAt, transitDuration + randomInt(-3, 5));
    history.push({ order_id: orderId, from_status: "shipping", to_status: "completed", changed_by: shipperId || null, note: null, created_at: completedAt });

    return history;
};

/* ---------- data loading ---------- */

const loadSeedSourceData = async (client) => {
    const customersResult = await client.query(`
        SELECT c.id AS customer_id, c.full_name, c.phone_number, c.rank,
               ca.id AS address_id, ca.address_line,
               w.id AS ward_id, w.name AS ward_name, w.shipping_fee
        FROM customers c
        JOIN customer_addresses ca ON ca.customer_id = c.id AND ca.is_default = TRUE
        JOIN wards w ON w.id = ca.ward_id
        WHERE c.is_active = TRUE
        ORDER BY c.id ASC
    `);

    const shippersResult = await client.query(`
        SELECT id, full_name, phone_number
        FROM users WHERE role = 'shipper' AND is_active = TRUE
        ORDER BY id ASC
    `);

    const menuItemsResult = await client.query(`
        SELECT id, name, price
        FROM menu_items WHERE is_available = TRUE
        ORDER BY id ASC
    `);

    const existingOrdersResult = await client.query(`SELECT order_code FROM orders`);

    if (customersResult.rowCount === 0) throw new Error("NO_ACTIVE_CUSTOMERS_WITH_DEFAULT_ADDRESS");
    if (shippersResult.rowCount === 0) throw new Error("NO_ACTIVE_SHIPPERS");
    if (menuItemsResult.rowCount === 0) throw new Error("NO_AVAILABLE_MENU_ITEMS");

    return {
        customers: customersResult.rows.map((r) => ({
            customer_id: Number(r.customer_id),
            full_name: r.full_name,
            phone_number: r.phone_number,
            rank: r.rank,
            address_id: Number(r.address_id),
            address_line: r.address_line,
            ward_id: Number(r.ward_id),
            ward_name: r.ward_name,
            shipping_fee: Number(r.shipping_fee)
        })),
        shippers: shippersResult.rows.map((r) => ({
            id: Number(r.id),
            full_name: r.full_name,
            phone_number: r.phone_number
        })),
        menuItems: menuItemsResult.rows.map((r) => ({
            id: Number(r.id),
            name: r.name,
            price: Number(r.price)
        })),
        existingCodes: new Set(existingOrdersResult.rows.map((r) => r.order_code))
    };
};

/* ---------- ensure addresses ---------- */

const SAMPLE_STREETS = [
    "Đường 3/2", "Đường Nguyễn Văn Cừ", "Đường 30/4", "Đường Trần Hưng Đạo",
    "Đường Lý Tự Trọng", "Đường Mậu Thân", "Đường Hùng Vương", "Đường CMT8",
    "Đường Nguyễn Trãi", "Đường Phan Đình Phùng", "Đường Lê Lợi", "Đường Hai Bà Trưng",
    "Đường Nguyễn An Ninh", "Đường Trần Phú", "Đường Võ Văn Kiệt", "Đường Lê Hồng Phong",
    "Đường Xô Viết Nghệ Tĩnh", "Đường Nguyễn Văn Linh", "Đường Cách Mạng Tháng 8"
];

const ensureCustomerAddresses = async (client, wards) => {
    // Find customers without any default address
    const result = await client.query(`
        SELECT c.id FROM customers c
        WHERE c.is_active = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM customer_addresses ca
            WHERE ca.customer_id = c.id AND ca.is_default = TRUE
          )
        ORDER BY c.id
    `);

    if (result.rowCount === 0) {
        console.log("  All customers already have default addresses.");
        return 0;
    }

    const customerIds = result.rows.map((r) => r.id);
    console.log(`  Creating default addresses for ${customerIds.length} customers...`);

    for (const customerId of customerIds) {
        const ward = pickOne(wards);
        const houseNum = randomInt(1, 300);
        const street = pickOne(SAMPLE_STREETS);
        const addressLine = `${houseNum} ${street}`;

        await client.query(
            `INSERT INTO customer_addresses (customer_id, address_line, ward_id, is_default)
             VALUES ($1, $2, $3, TRUE)`,
            [customerId, addressLine, ward.id]
        );
    }

    return customerIds.length;
};

/* ---------- order blueprint ---------- */

// Only orders created within the last RECENT_WINDOW_MINUTES before toDate
// can have in-progress statuses. Older orders must be completed or cancelled.
const RECENT_WINDOW_MINUTES = 120; // 2 hours

const TERMINAL_STATUSES = [
    { name: "completed", weight: 85 },
    { name: "cancelled", weight: 15 }
];

const IN_PROGRESS_STATUSES = [
    { name: "pending", weight: 20 },
    { name: "confirmed", weight: 20 },
    { name: "preparing", weight: 25 },
    { name: "shipping", weight: 35 }
];

const createOrderBlueprint = ({ customers, shippers, menuItems, generateOrderCode, fromDate, toDate }) => {
    const customer = pickOne(customers);
    const createdAt = randomOrderTimestamp(fromDate, toDate);

    // Determine if this order is "recent" (within last 2 hours of toDate)
    const recentCutoff = addMinutes(toDate, -RECENT_WINDOW_MINUTES);
    const isRecent = createdAt >= recentCutoff;

    // Old orders must be completed/cancelled; recent orders can be in any state
    const status = isRecent
        ? pickWeighted(ORDER_STATUSES)
        : pickWeighted(TERMINAL_STATUSES);

    const shipperId = ["shipping", "completed"].includes(status) ? pickOne(shippers).id : null;
    const items = sampleMenuItems(menuItems);
    const itemCount = items.reduce((s, i) => s + i.quantity, 0);
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const shippingFee = Number(customer.shipping_fee || 0);
    const discountAmount = 0;
    const totalAmount = subtotal + shippingFee - discountAmount;
    const orderCode = generateOrderCode(createdAt);

    // Compute realistic delivery time
    const deliveryMinutes = computeDeliveryMinutes(customer.ward_name, itemCount, createdAt);

    // updatedAt = last status change timestamp
    const updatedAt = (() => {
        if (status === "pending") return addMinutes(createdAt, 1);
        if (status === "confirmed") return addMinutes(createdAt, randomInt(4, 16));
        if (status === "cancelled") return addMinutes(createdAt, randomInt(5, 35));
        if (status === "preparing") return addMinutes(createdAt, randomInt(10, 30));
        if (status === "shipping") return addMinutes(createdAt, randomInt(20, Math.round(deliveryMinutes * 0.7)));
        // completed: full delivery cycle
        return addMinutes(createdAt, deliveryMinutes + randomInt(10, 30));
    })();

    const paymentState = buildPaymentState({ status, createdAt, updatedAt });

    return {
        orderCode, customerId: customer.customer_id, shipperId,
        deliveryFullName: customer.full_name, deliveryPhone: customer.phone_number,
        deliveryAddress: customer.address_line, deliveryWardName: customer.ward_name,
        shippingFee, subtotal, discountAmount, totalAmount,
        status, notes: pickOne(ORDER_NOTES),
        createdAt, updatedAt, items,
        paymentMethod: "cash",
        paymentState,
        deliveryMinutes
    };
};

/* ---------- insert ---------- */

const insertSeededOrders = async (client, blueprints) => {
    const inserted = [];

    for (const bp of blueprints) {
        const orderRes = await client.query(
            `INSERT INTO orders (
                order_code, customer_id, shipper_id,
                delivery_full_name, delivery_phone, delivery_address, delivery_ward_name,
                shipping_fee, subtotal, discount_amount, total_amount,
                status, notes, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING id, order_code`,
            [
                bp.orderCode, bp.customerId, bp.shipperId,
                bp.deliveryFullName, bp.deliveryPhone, bp.deliveryAddress, bp.deliveryWardName,
                bp.shippingFee, bp.subtotal, bp.discountAmount, bp.totalAmount,
                bp.status, bp.notes, bp.createdAt, bp.updatedAt
            ]
        );

        const orderId = Number(orderRes.rows[0].id);

        for (const item of bp.items) {
            await client.query(
                `INSERT INTO order_items (order_id, menu_item_id, quantity, price, note)
                 VALUES ($1,$2,$3,$4,$5)`,
                [orderId, item.menu_item_id, item.quantity, item.price, item.note]
            );
        }

        await client.query(
            `INSERT INTO payments (order_id, method, payment_status, amount, paid_at, refund_marked_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [orderId, bp.paymentMethod, bp.paymentState.payment_status, bp.totalAmount,
                bp.paymentState.paid_at, bp.paymentState.refund_marked_at, bp.createdAt]
        );

        const historyEntries = buildStatusHistory({
            orderId, status: bp.status, shipperId: bp.shipperId,
            createdAt: bp.createdAt, deliveryMinutes: bp.deliveryMinutes
        });

        for (const entry of historyEntries) {
            await client.query(
                `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [entry.order_id, entry.from_status, entry.to_status, entry.changed_by, entry.note, entry.created_at]
            );
        }

        inserted.push({
            id: orderId, orderCode: bp.orderCode,
            customerId: bp.customerId, status: bp.status,
            totalAmount: bp.totalAmount, wardName: bp.deliveryWardName,
            deliveryMinutes: bp.deliveryMinutes
        });
    }

    // Recompute sold_count from completed orders
    await client.query(`UPDATE menu_items SET sold_count = 0`);
    await client.query(`
        UPDATE menu_items mi
        SET sold_count = totals.sold_count
        FROM (
            SELECT oi.menu_item_id, COALESCE(SUM(oi.quantity), 0)::int AS sold_count
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status = 'completed'
            GROUP BY oi.menu_item_id
        ) totals
        WHERE mi.id = totals.menu_item_id
    `);

    // Recompute customer rank
    await client.query(`
        UPDATE customers c
        SET total_spent = totals.total_spent,
            rank = CASE WHEN totals.total_spent >= $1 THEN 'loyal' ELSE 'normal' END
        FROM (
            SELECT customer_id, COALESCE(SUM(total_amount), 0)::numeric AS total_spent
            FROM orders WHERE status = 'completed' AND customer_id IS NOT NULL
            GROUP BY customer_id
        ) totals
        WHERE c.id = totals.customer_id
    `, [RANK_THRESHOLD]);

    await client.query(`
        UPDATE customers c
        SET total_spent = 0, rank = 'normal'
        WHERE NOT EXISTS (
            SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed'
        )
    `);

    return inserted;
};

/* ---------- summary ---------- */

const summarizeByStatus = (orders) =>
    orders.reduce((s, o) => { s[o.status] = (s[o.status] || 0) + 1; return s; }, {});

const summarizeDeliveryByWard = (orders) => {
    const result = {};
    for (const o of orders) {
        if (!["shipping", "completed"].includes(o.status)) continue;
        const ward = o.wardName || o.deliveryWardName;
        if (!result[ward]) result[ward] = { count: 0, totalMin: 0 };
        result[ward].count++;
        result[ward].totalMin += o.deliveryMinutes;
    }
    for (const ward of Object.keys(result)) {
        result[ward].avgMin = Math.round(result[ward].totalMin / result[ward].count);
        delete result[ward].totalMin;
    }
    return result;
};

/* ---------- main ---------- */

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    const { fromDate, toDate } = assertValidOptions(options);

    const client = await db.pool.connect();
    try {
        // Step 1: Ensure all customers have default addresses
        console.log("[1/3] Ensuring customer addresses...");
        const wardsResult = await client.query(`SELECT id, name, shipping_fee FROM wards ORDER BY id`);
        const wards = wardsResult.rows;
        const addressesCreated = await ensureCustomerAddresses(client, wards);
        console.log(`  Done. ${addressesCreated} addresses created.`);

        // Step 2: Load seed source data
        console.log("[2/3] Loading seed source data...");
        const seedData = await loadSeedSourceData(client);
        const generateOrderCode = buildOrderCodeFactory(seedData.existingCodes);
        console.log(`  ${seedData.customers.length} customers, ${seedData.shippers.length} shippers, ${seedData.menuItems.length} menu items`);

        // Step 3: Generate order blueprints
        const blueprints = Array.from({ length: options.count }, () =>
            createOrderBlueprint({
                customers: seedData.customers,
                shippers: seedData.shippers,
                menuItems: seedData.menuItems,
                generateOrderCode,
                fromDate,
                toDate
            })
        );

        const preview = {
            count: blueprints.length,
            range: { from: fromDate.toISOString(), to: toDate.toISOString() },
            customersUsed: new Set(blueprints.map((b) => b.customerId)).size,
            shippersUsed: new Set(blueprints.filter((b) => b.shipperId).map((b) => b.shipperId)).size,
            statuses: summarizeByStatus(blueprints),
            deliveryByWard: summarizeDeliveryByWard(blueprints),
            sampleOrderCodes: blueprints.slice(0, 5).map((b) => b.orderCode),
            allPaymentsCash: blueprints.every((b) => b.paymentMethod === "cash"),
            orderTimeRange: {
                earliest: blueprints.reduce((min, b) => b.createdAt < min ? b.createdAt : min, blueprints[0].createdAt).toLocaleTimeString("vi-VN"),
                latest: blueprints.reduce((max, b) => b.createdAt > max ? b.createdAt : max, blueprints[0].createdAt).toLocaleTimeString("vi-VN")
            }
        };

        if (options.dryRun) {
            console.log("[3/3] DRY RUN — no data inserted.");
            console.log(JSON.stringify({ dryRun: true, preview }, null, 2));
            return;
        }

        console.log("[3/3] Inserting orders...");
        await client.query("BEGIN");
        const insertedOrders = await insertSeededOrders(client, blueprints);
        await client.query("COMMIT");

        console.log(JSON.stringify({
            inserted: insertedOrders.length,
            preview,
            firstOrderCode: insertedOrders[0]?.orderCode || null,
            lastOrderCode: insertedOrders[insertedOrders.length - 1]?.orderCode || null
        }, null, 2));
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch { }
        console.error(error.stack || error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await db.pool.end();
    }
};

main();
