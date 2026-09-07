const db = require("../config/db");

const getMenuTypes = async () => {
    let query = `SELECT * FROM menu_types`;
    const values = [];
    const result = await db.query(query, values);
    return result.rows;
};

const createMenuType = async (name) => {
    const result = await db.query(
        `
            INSERT INTO menu_types (name)
            VALUES ($1)
            RETURNING id, name
        `,
        [name]
    );

    return result.rows[0];
};

module.exports = {
    getMenuTypes,
    createMenuType
};