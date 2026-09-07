const db = require("../config/db");

const getVouchers = async ({ search = "", sortBy = "created_at", sortDir = "desc", page = 1, limit = 5 } = {}) => {
    const values = [];
    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    let fromWhere = `
        FROM vouchers
    `;

    if (search) {
        values.push(`%${search}%`);
        fromWhere += ` WHERE code ILIKE $${values.length}`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, values);
    const totalItems = countResult.rows[0]?.total || 0;

    const sortMap = {
        code: "code",
        discount_percent: "discount_percent",
        discount_amount: "discount_amount",
        min_order_value: "min_order_value",
        max_discount: "max_discount",
        expiry_date: "expiry_date",
        usage_limit: "usage_limit",
        used_count: "used_count",
        is_active: "is_active",
        created_at: "created_at"
    };

    const safeSortBy = sortMap[sortBy] || "created_at";
    const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    values.push(safeLimit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const query = `
        SELECT
            id,
            code,
            discount_percent,
            discount_amount,
            min_order_value,
            max_discount,
            expiry_date,
            usage_limit,
            used_count,
            max_usage_per_customer,
            applicable_rank,
            is_active,
            created_at
        ${fromWhere}
        ORDER BY ${safeSortBy} ${safeSortDir}, id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await db.query(query, values);
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

const createVoucher = async ({
    code,
    discountPercent,
    discountAmount,
    minOrderValue,
    maxDiscount,
    expiryDate,
    usageLimit,
    maxUsagePerCustomer,
    applicableRank,
    isActive
}) => {
    const result = await db.query(
        `
            INSERT INTO vouchers (
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                max_usage_per_customer,
                applicable_rank,
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING
                id,
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                used_count,
                max_usage_per_customer,
                applicable_rank,
                is_active,
                created_at
        `,
        [code, discountPercent, discountAmount, minOrderValue, maxDiscount, expiryDate, usageLimit, maxUsagePerCustomer, applicableRank, isActive]
    );

    return result.rows[0];
};

const getVoucherByCode = async (code) => {
    const result = await db.query(
        `
            SELECT
                id,
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                used_count,
                max_usage_per_customer,
                applicable_rank,
                is_active,
                created_at
            FROM vouchers
            WHERE UPPER(code) = UPPER($1)
            LIMIT 1
        `,
        [code]
    );

    return result.rows[0] || null;
};

const getVoucherById = async (id) => {
    const result = await db.query(
        `
            SELECT
                id,
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                used_count,
                max_usage_per_customer,
                applicable_rank,
                is_active,
                created_at
            FROM vouchers
            WHERE id = $1
            LIMIT 1
        `,
        [id]
    );

    return result.rows[0] || null;
};

const updateVoucher = async (
    id,
    {
        code,
        discountPercent,
        discountAmount,
        minOrderValue,
        maxDiscount,
        expiryDate,
        usageLimit,
        maxUsagePerCustomer,
        applicableRank,
        isActive
    }
) => {
    const result = await db.query(
        `
            UPDATE vouchers
            SET
                code = $1,
                discount_percent = $2,
                discount_amount = $3,
                min_order_value = $4,
                max_discount = $5,
                expiry_date = $6,
                usage_limit = $7,
                max_usage_per_customer = $8,
                applicable_rank = $9,
                is_active = $10
            WHERE id = $11
            RETURNING
                id,
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                used_count,
                max_usage_per_customer,
                applicable_rank,
                is_active,
                created_at
        `,
        [code, discountPercent, discountAmount, minOrderValue, maxDiscount, expiryDate, usageLimit, maxUsagePerCustomer, applicableRank, isActive, id]
    );

    return result.rows[0] || null;
};

const deleteVoucher = async (id) => {
    const result = await db.query(
        `
            DELETE FROM vouchers
            WHERE id = $1
            RETURNING
                id,
                code,
                discount_percent,
                discount_amount,
                min_order_value,
                max_discount,
                expiry_date,
                usage_limit,
                used_count,
                max_usage_per_customer,
                applicable_rank,
                is_active,
                created_at
        `,
        [id]
    );

    return result.rows[0] || null;
};

const getCustomerVoucherUsage = async (customerId, voucherId) => {
    const result = await db.query(
        `SELECT used_count FROM customer_voucher_usage WHERE customer_id = $1 AND voucher_id = $2`,
        [customerId, voucherId]
    );
    return result.rows[0]?.used_count || 0;
};

const toggleVoucher = async (id) => {
    const result = await db.query(
        `UPDATE vouchers SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active`,
        [id]
    );
    return result.rows[0] || null;
};

module.exports = {
    getVouchers,
    createVoucher,
    getVoucherByCode,
    getVoucherById,
    updateVoucher,
    deleteVoucher,
    toggleVoucher,
    getCustomerVoucherUsage
};
