const db = require("../config/db");

const getWards = async ({ search = "", sortBy = "name", sortDir = "asc", page = 1, limit = 5 } = {}) => {
    const values = [];
    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    let fromWhere = `
        FROM wards
    `;

    if (search) {
        values.push(`%${search}%`);
        fromWhere += ` WHERE name ILIKE $${values.length}`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, values);
    const totalItems = countResult.rows[0]?.total || 0;

    const sortMap = {
        name: "name",
        shipping_fee: "shipping_fee"
    };
    const safeSortBy = sortMap[sortBy] || "name";
    const safeSortDir = String(sortDir).toLowerCase() === "desc" ? "DESC" : "ASC";

    values.push(safeLimit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const query = `
        SELECT id, name, shipping_fee
        ${fromWhere}
        ORDER BY ${safeSortBy} ${safeSortDir}
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

const createWard = async (name, shippingFee) => {
    const result = await db.query(
        `
            INSERT INTO wards (name, shipping_fee)
            VALUES ($1, $2)
            RETURNING id, name, shipping_fee
        `,
        [name, shippingFee]
    );

    return result.rows[0];
};

const updateWard = async (id, name, shippingFee) => {
    const result = await db.query(
        `
            UPDATE wards
            SET name = $1, shipping_fee = $2
            WHERE id = $3
            RETURNING id, name, shipping_fee
        `,
        [name, shippingFee, id]
    );

    return result.rows[0] || null;
};

const deleteWard = async (id) => {
    const result = await db.query(
        `
            DELETE FROM wards
            WHERE id = $1
            RETURNING id, name, shipping_fee
        `,
        [id]
    );

    return result.rows[0] || null;
};

module.exports = {
    getWards,
    createWard,
    updateWard,
    deleteWard
};