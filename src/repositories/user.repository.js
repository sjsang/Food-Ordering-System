const db = require("../config/db");

const getUsers = async ({ search = "", role = "all", isActive = "all", sortBy = "created_at", sortDir = "desc", page = 1, limit = 5 } = {}) => {
    const values = [];
    const conditions = [];

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    let fromWhere = `
        FROM users
    `;

    if (search) {
        values.push(`%${search}%`);
        conditions.push(`(username ILIKE $${values.length} OR full_name ILIKE $${values.length} OR phone_number ILIKE $${values.length})`);
    }

    if (["admin", "shipper"].includes(role)) {
        values.push(role);
        conditions.push(`role = $${values.length}`);
    }

    if (isActive === "true" || isActive === "false") {
        values.push(isActive === "true");
        conditions.push(`is_active = $${values.length}`);
    }

    if (conditions.length > 0) {
        fromWhere += ` WHERE ${conditions.join(" AND ")}`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, values);
    const totalItems = countResult.rows[0]?.total || 0;

    const sortMap = {
        created_at: "created_at",
        username: "username",
        full_name: "full_name",
        role: "role"
    };
    const safeSortBy = sortMap[sortBy] || "created_at";
    const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    values.push(safeLimit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const dataQuery = `
        SELECT id, username, full_name, phone_number, avatar_url, role, is_active, created_at
        ${fromWhere}
        ORDER BY ${safeSortBy} ${safeSortDir}
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await db.query(dataQuery, values);
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

const createUserByAdmin = async (userData) => {
    const { username, password_hash, full_name, phone_number, role } = userData;
    const query = `
        INSERT INTO users (username, password_hash, full_name, phone_number, role, avatar_url)
        VALUES ($1, $2, $3, $4, $5, 'no-avatar_hblnf5')
        RETURNING id, username, full_name, phone_number, avatar_url, role, is_active, created_at
    `;
    const result = await db.query(query, [username, password_hash, full_name, phone_number, role]);
    return result.rows[0];
};

const getUserById = async (id) => {
    const query = `
        SELECT id, username, full_name, phone_number, avatar_url, role, is_active, created_at
        FROM users
        WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
};

const getMyProfile = async (id) => {
    const query = `
        SELECT id, username, full_name, phone_number, avatar_url, role, is_active, created_at
        FROM users
        WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
};

const toggleUserStatus = async (id) => {
    const query = `
        UPDATE users
        SET is_active = NOT is_active
        WHERE id = $1
        RETURNING id, username, full_name, phone_number, avatar_url, role, is_active, created_at
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
};

const updateUser = async (id, { full_name, phone_number, role, password_hash }) => {
    let query = `UPDATE users SET full_name=$1, phone_number=$2, role=$3`;
    const params = [full_name, phone_number, role];

    if (password_hash) {
        params.push(password_hash);
        query += `, password_hash=$${params.length}`;
    }

    params.push(id);
    query += ` WHERE id=$${params.length} RETURNING id, username, full_name, phone_number, avatar_url, role, is_active, created_at`;
    const result = await db.query(query, params);
    return result.rows[0] || null;
};

const updateMyProfile = async (id, { full_name, phone_number, password_hash }) => {
    let query = `UPDATE users SET full_name=$1, phone_number=$2`;
    const params = [full_name, phone_number];

    if (password_hash) {
        params.push(password_hash);
        query += `, password_hash=$${params.length}`;
    }

    params.push(id);
    query += ` WHERE id=$${params.length} RETURNING id, username, full_name, phone_number, avatar_url, role, is_active, created_at`;
    const result = await db.query(query, params);
    return result.rows[0] || null;
};

const updateMyAvatar = async (id, avatarUrl) => {
    const query = `
        UPDATE users
        SET avatar_url = $1
        WHERE id = $2
        RETURNING id, username, full_name, phone_number, avatar_url, role, is_active, created_at
    `;
    const result = await db.query(query, [avatarUrl, id]);
    return result.rows[0] || null;
};

const getAssignedOrders = async (userId) => {
    const query = `
        SELECT
            o.order_code,
            o.delivery_full_name,
            o.delivery_phone,
            o.delivery_address,
            o.total_amount,
            o.status,
            o.created_at,
            'shipper' AS assignment_type
        FROM orders o
        WHERE o.shipper_id = $1
          AND o.status != 'cart'
        ORDER BY o.created_at DESC
        LIMIT 50
    `;
    const result = await db.query(query, [userId]);
    return result.rows;
};

module.exports = {
    getUsers,
    createUserByAdmin,
    getUserById,
    toggleUserStatus,
    updateUser,
    getMyProfile,
    updateMyProfile,
    updateMyAvatar,
    getAssignedOrders
};