const db = require("../config/db");

const loginAdmin = async (username) => {
    const query = `SELECT * FROM users WHERE username = $1 AND is_active = TRUE`;
    const result = await db.query(query, [username]);
    return result.rows[0] || null;
};

const registerCustomer = async (customerData) => {
    const { full_name, phone_number, email, password_hash } = customerData;
    const query = `INSERT INTO customers (full_name, phone_number, email, password_hash, avatar_url)
                   VALUES ($1, $2, $3, $4, 'no-avatar_hblnf5') RETURNING id`;
    const result = await db.query(query, [full_name, phone_number, email, password_hash]);
    return result.rows[0].id;
};

const getCustomerByEmail = async (email) => {
    const query = `SELECT id, email FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1`;
    const result = await db.query(query, [email]);
    return result.rows[0] || null;
};

const getCustomerByPhone = async (phoneNumber) => {
    const query = `SELECT id, phone_number FROM customers WHERE phone_number = $1 LIMIT 1`;
    const result = await db.query(query, [phoneNumber]);
    return result.rows[0] || null;
};

const loginCustomer = async (email) => {
    const query = `SELECT * FROM customers WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`;
    const result = await db.query(query, [email]);
    return result.rows[0] || null;
};

const getCustomerById = async (id) => {
    const query = `
        SELECT
            c.id,
            c.full_name,
            c.phone_number,
            c.email,
            c.avatar_url,
            c.rank,
            c.total_spent,
            c.is_active,
            c.created_at,
            ca.id AS address_id,
            ca.address_line AS address,
            w.id AS ward_id,
            w.name AS ward_name,
            w.shipping_fee
        FROM customers c
        LEFT JOIN customer_addresses ca
            ON ca.customer_id = c.id
            AND ca.is_default = TRUE
        LEFT JOIN wards w
            ON w.id = ca.ward_id
        WHERE c.id = $1
    `;

    const result = await db.query(query, [id]);

    return result.rows[0] || null;
};

module.exports = {
    registerCustomer,
    getCustomerByEmail,
    getCustomerByPhone,
    loginCustomer,
    loginAdmin,
    getCustomerById
};