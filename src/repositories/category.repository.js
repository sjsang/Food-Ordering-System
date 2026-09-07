const db = require("../config/db");

const getCategories = async (type) => {
    let query = `
        SELECT categories.*
        FROM categories
        JOIN menu_types ON categories.menu_type_id = menu_types.id
    `;
    const values = [];

    if (type) {
        values.push(type);
        query += ` WHERE menu_types.name = $${values.length}`;
    }
    query += ` ORDER BY categories.menu_type_id ASC, categories.name ASC`;
    const result = await db.query(query, values);
    return result.rows;
};

const menuTypeExists = async (menuTypeId) => {
    const result = await db.query(
        `
            SELECT 1
            FROM menu_types
            WHERE id = $1
            LIMIT 1
        `,
        [menuTypeId]
    );

    return result.rowCount > 0;
};

const createCategory = async (name, menuTypeId) => {
    const result = await db.query(
        `
            INSERT INTO categories (name, menu_type_id)
            VALUES ($1, $2)
            RETURNING id, name, menu_type_id
        `,
        [name, menuTypeId]
    );

    return result.rows[0];
};

const updateCategory = async (id, name, menuTypeId) => {
    const result = await db.query(
        `
            UPDATE categories
            SET name = $1,
                menu_type_id = $2
            WHERE id = $3
            RETURNING id, name, menu_type_id
        `,
        [name, menuTypeId, id]
    );

    return result.rows[0] || null;
};

const deleteCategory = async (id) => {
    const result = await db.query(
        `
            DELETE FROM categories
            WHERE id = $1
            RETURNING id, name, menu_type_id
        `,
        [id]
    );

    return result.rows[0] || null;
};

module.exports = {
    getCategories,
    menuTypeExists,
    createCategory,
    updateCategory,
    deleteCategory
};