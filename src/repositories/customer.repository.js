const db = require("../config/db");

const getCustomers = async ({ search = "", isActive = "all", sortBy = "created_at", sortDir = "desc", page = 1, limit = 5 } = {}) => {
    const values = [];
    const conditions = [];

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    let fromWhere = `
        FROM customers
    `;

    if (search) {
        values.push(`%${search}%`);
        conditions.push(`(full_name ILIKE $${values.length} OR phone_number ILIKE $${values.length} OR email ILIKE $${values.length})`);
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
        full_name: "full_name",
        phone_number: "phone_number"
    };
    const safeSortBy = sortMap[sortBy] || "created_at";
    const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    values.push(safeLimit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const dataQuery = `
        SELECT id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at
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

const createCustomerByAdmin = async (customerData) => {
    const { full_name, phone_number, email, password_hash } = customerData;
    const query = `
        INSERT INTO customers (full_name, phone_number, email, password_hash, avatar_url)
        VALUES ($1, $2, NULLIF($3, ''), $4, 'no-avatar_hblnf5')
        RETURNING id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at
    `;
    const result = await db.query(query, [full_name, phone_number, email || '', password_hash]);
    return result.rows[0];
};

const updateCustomer = async (id, name, email, phone) => {
    const query = `UPDATE customers SET full_name = $1, email = $2, phone_number = $3 WHERE id = $4 RETURNING *`;
    const values = [name, email, phone, id];
    const result = await db.query(query, values);
    return result.rows[0];
};

const updateCustomerByAdmin = async (id, { full_name, phone_number, email, password_hash }) => {
    let query = `UPDATE customers SET full_name=$1, phone_number=$2, email=NULLIF($3,'')`;
    const params = [full_name, phone_number, email || ''];

    if (password_hash) {
        params.push(password_hash);
        query += `, password_hash=$${params.length}`;
    }

    params.push(id);
    query += ` WHERE id=$${params.length} RETURNING id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at`;
    const result = await db.query(query, params);
    return result.rows[0] || null;
};

const updateCustomerAvatar = async (id, avatarUrl) => {
    const query = `
        UPDATE customers
        SET avatar_url = $1
        WHERE id = $2
        RETURNING id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at
    `;
    const result = await db.query(query, [avatarUrl, id]);
    return result.rows[0] || null;
};

// Address Management
const getCustomerAddresses = async (customerId) => {
    const query = `
        SELECT ca.id, ca.address_line, w.id as ward_id, w.name as ward_name, w.shipping_fee, ca.is_default, ca.created_at
        FROM customer_addresses ca
        JOIN wards w ON ca.ward_id = w.id
        WHERE ca.customer_id = $1
        ORDER BY ca.is_default DESC, ca.created_at DESC
    `;
    const result = await db.query(query, [customerId]);
    return result.rows;
};

const addCustomerAddress = async (customerId, addressLine, wardId) => {
    const query = `
        INSERT INTO customer_addresses (customer_id, address_line, ward_id, is_default)
        VALUES ($1, $2, $3, (SELECT COUNT(*) = 0 FROM customer_addresses WHERE customer_id = $1))
        RETURNING id, address_line, ward_id, is_default, created_at
    `;
    const result = await db.query(query, [customerId, addressLine, wardId]);
    return result.rows[0];
};

const updateCustomerAddress = async (addressId, addressLine, wardId) => {
    const query = `
        UPDATE customer_addresses 
        SET address_line = $1, ward_id = $2
        WHERE id = $3
        RETURNING id, address_line, ward_id, is_default, created_at
    `;
    const result = await db.query(query, [addressLine, wardId, addressId]);
    return result.rows[0];
};

const deleteCustomerAddress = async (addressId) => {
    const query = `DELETE FROM customer_addresses WHERE id = $1`;
    await db.query(query, [addressId]);
};

const setDefaultAddress = async (customerId, addressId) => {
    // Update all addresses to not default
    await db.query(
        `UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = $1`,
        [customerId]
    );

    // Set the selected address as default
    const query = `
        UPDATE customer_addresses 
        SET is_default = TRUE
        WHERE id = $1 AND customer_id = $2
        RETURNING id, address_line, ward_id, is_default, created_at
    `;
    const result = await db.query(query, [addressId, customerId]);
    return result.rows[0];
};

const getCustomerById = async (id) => {
    const query = `
        SELECT id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at
        FROM customers
        WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
};

const toggleCustomerStatus = async (id) => {
    const query = `
        UPDATE customers
        SET is_active = NOT is_active
        WHERE id = $1
        RETURNING id, full_name, phone_number, email, avatar_url, rank, total_spent, is_active, created_at
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
};

const getCustomerOrders = async (customerId) => {
    const query = `
        SELECT order_code, delivery_full_name, delivery_phone, delivery_address,
               total_amount, status, created_at
        FROM orders
        WHERE customer_id = $1 AND status != 'cart'
        ORDER BY created_at DESC
    `;
    const result = await db.query(query, [customerId]);
    return result.rows;
};

const getCustomerTotalSpent = async (customerId) => {
    const query = `
        SELECT COALESCE(SUM(total_amount), 0)::numeric AS total_spent
        FROM orders
        WHERE customer_id = $1 AND status = 'completed'
    `;
    const result = await db.query(query, [customerId]);
    return Number(result.rows[0]?.total_spent || 0);
};

const updateCustomerRank = async (customerId, rank, totalSpent) => {
    const query = `
        UPDATE customers
        SET rank = $1, total_spent = $2
        WHERE id = $3
        RETURNING id, rank, total_spent
    `;
    const result = await db.query(query, [rank, totalSpent, customerId]);
    return result.rows[0] || null;
};

const getCustomerAddressesByAdmin = async (customerId) => {
    const query = `
        SELECT ca.id, ca.address_line, w.name as ward_name, w.shipping_fee, ca.is_default, ca.created_at
        FROM customer_addresses ca
        JOIN wards w ON ca.ward_id = w.id
        WHERE ca.customer_id = $1
        ORDER BY ca.is_default DESC, ca.created_at DESC
    `;
    const result = await db.query(query, [customerId]);
    return result.rows;
};

module.exports = {
    getCustomers,
    createCustomerByAdmin,
    updateCustomer,
    updateCustomerByAdmin,
    updateCustomerAvatar,
    getCustomerAddresses,
    addCustomerAddress,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultAddress,
    getCustomerById,
    toggleCustomerStatus,
    getCustomerOrders,
    getCustomerAddressesByAdmin,
    getCustomerTotalSpent,
    updateCustomerRank
};