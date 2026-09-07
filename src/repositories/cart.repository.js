const db = require("../config/db");

const getCartItems = async (userId) => {
    const itemsQuery = `
        SELECT
            ci.id,
            ci.menu_item_id,
            mi.name,
            mi.image_url,
            mi.price,
            ci.quantity,
            ci.note
        FROM cart_items ci
        JOIN carts c ON ci.cart_id = c.id
        JOIN menu_items mi ON ci.menu_item_id = mi.id
        WHERE c.customer_id = $1
    `;
    const itemsResult = await db.query(itemsQuery, [userId]);
    const items = itemsResult.rows;

    const totalQuery = `
        SELECT SUM(ci.quantity * mi.price) AS total_cart
        FROM cart_items ci
        JOIN carts c ON ci.cart_id = c.id
        JOIN menu_items mi ON ci.menu_item_id = mi.id
        WHERE c.customer_id = $1
    `;
    const totalResult = await db.query(totalQuery, [userId]);
    const totalCart = totalResult.rows[0].total_cart || 0;

    return { items, totalCart };
};

const addCartItem = async (userId, menuItemId, quantity, note) => {
    let cartResult = await db.query(
        `SELECT id FROM carts WHERE customer_id = $1`,
        [userId]
    );

    let cartId;

    if (cartResult.rowCount === 0) {
        const newCart = await db.query(
            `INSERT INTO carts (customer_id)
             VALUES ($1)
             RETURNING id`,
            [userId]
        );
        cartId = newCart.rows[0].id;
    } else {
        cartId = cartResult.rows[0].id;
    }

    await db.query(
        `INSERT INTO cart_items (cart_id, menu_item_id, quantity, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cart_id, menu_item_id)
         DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
                       note = EXCLUDED.note`,
        [cartId, menuItemId, quantity, note]
    );
};

const updateCartItem = async (userId, menuItemId, quantity, note) => {
    let query = `UPDATE cart_items
                 SET quantity = $3,
                     note = $4
                    WHERE cart_id = (
                        SELECT id FROM carts WHERE customer_id = $1
                    ) AND menu_item_id = $2`;
    await db.query(query, [userId, menuItemId, quantity, note]);
};

const deleteCartItem = async (userId, menuItemId) => {
    let query = `DELETE FROM cart_items
                 WHERE cart_id = (
                     SELECT id FROM carts WHERE customer_id = $1
                 ) AND menu_item_id = $2`;
    await db.query(query, [userId, menuItemId]);
};

const deleteAllCartItems = async (userId) => {
    let query = `DELETE FROM cart_items
                 WHERE cart_id = (
                        SELECT id FROM carts WHERE customer_id = $1
                    )`;
    await db.query(query, [userId]);
};

module.exports = {
    getCartItems,
    addCartItem,
    updateCartItem,
    deleteCartItem,
    deleteAllCartItems,
};