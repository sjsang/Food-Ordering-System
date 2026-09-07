const db = require("../config/db");

const MENU_RATING_AGGREGATE_SQL = `
    LEFT JOIN (
        SELECT
            ori.menu_item_id,
            ROUND(AVG(ori.rating)::numeric, 2) AS avg_rating,
            COUNT(*)::int AS rating_count
        FROM order_review_items ori
        GROUP BY ori.menu_item_id
    ) menu_rating_stats ON menu_rating_stats.menu_item_id = menu_items.id
`;

const getMenuItems = async ({ type, category, search, sort, available, featured, page, limit } = {}) => {

    let query = `
        SELECT menu_items.*,
               COALESCE(menu_rating_stats.avg_rating, 0)::numeric(3,2) AS avg_rating
        FROM menu_items
        JOIN categories ON menu_items.category_id = categories.id
        JOIN menu_types ON categories.menu_type_id = menu_types.id
        ${MENU_RATING_AGGREGATE_SQL}
    `;

    const conditions = [];
    const values = [];

    if (type) {
        values.push(type);
        conditions.push(`menu_types.name = $${values.length}`);
    }

    if (category) {
        values.push(category);
        conditions.push(`categories.name = $${values.length}`);
    }

    if (search) {
        values.push(`%${search}%`);
        conditions.push(`menu_items.name ILIKE $${values.length}`);
    }

    if (available !== null && available !== undefined) {
        values.push(available);
        conditions.push(`menu_items.is_available = $${values.length}`);
    }

    if (featured !== null && featured !== undefined) {
        values.push(featured);
        conditions.push(`menu_items.is_featured = $${values.length}`);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(" AND ");
    }

    switch (sort) {
        case "price_asc":
            query += ` ORDER BY menu_items.price ASC`;
            break;
        case "price_desc":
            query += ` ORDER BY menu_items.price DESC`;
            break;
        case "sold_desc":
            query += ` ORDER BY menu_items.sold_count DESC, menu_items.name ASC`;
            break;
        case "sold_asc":
            query += ` ORDER BY menu_items.sold_count ASC, menu_items.name ASC`;
            break;
        case "rating_desc":
            query += ` ORDER BY COALESCE(menu_rating_stats.avg_rating, 0) DESC, menu_items.name ASC`;
            break;
        case "rating_asc":
            query += ` ORDER BY COALESCE(menu_rating_stats.avg_rating, 0) ASC, menu_items.name ASC`;
            break;
        case "name_desc":
            query += ` ORDER BY menu_items.name DESC`;
            break;
        default:
            query += ` ORDER BY menu_items.name ASC`;
    }

    const hasPagination = page !== undefined || limit !== undefined;
    if (!hasPagination) {
        const result = await db.query(query, values);
        return result.rows;
    }

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 5;
    const offset = (safePage - 1) * safeLimit;

    const countQuery = `SELECT COUNT(*)::int AS total FROM (${query}) AS filtered_menu_items`;
    const countResult = await db.query(countQuery, values);
    const totalItems = countResult.rows[0]?.total || 0;

    const paginatedValues = [...values, safeLimit, offset];
    const paginatedQuery = `${query} LIMIT $${paginatedValues.length - 1} OFFSET $${paginatedValues.length}`;
    const result = await db.query(paginatedQuery, paginatedValues);

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

const getMenuItemById = async (id) => {
    const query = `
        SELECT menu_items.*, 
               COALESCE(menu_rating_stats.avg_rating, 0)::numeric(3,2) AS avg_rating,
               COALESCE(menu_rating_stats.rating_count, 0)::int AS rating_count
        FROM menu_items
        ${MENU_RATING_AGGREGATE_SQL}
        WHERE menu_items.id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
}

const createMenuItem = async (name, description, price, categoryId, imageUrl, isAvailable) => {
    const query = `
        INSERT INTO menu_items (name, description, price, category_id, image_url, is_available)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE))
        RETURNING *
    `;
    const result = await db.query(query, [name, description, price, categoryId, imageUrl, isAvailable]);
    return result.rows[0];
};

const updateMenuItem = async (id, name, description, price, categoryId, imageUrl, isAvailable) => {
    const query = `
        UPDATE menu_items
        SET 
            name = COALESCE($1, name),
            description = COALESCE($2, description),
            price = COALESCE($3, price),
            category_id = COALESCE($4, category_id),
            image_url = COALESCE($5, image_url),
            is_available = COALESCE($6, is_available)
        WHERE id = $7
        RETURNING *
    `;
    const result = await db.query(query, [name, description, price, categoryId, imageUrl, isAvailable, id]);
    return result.rows[0];
};

const getFeaturedMenuItems = async () => {
    const query = `
        SELECT
            mi.id,
            mi.name,
            mi.description,
            mi.price,
            mi.image_url,
            COALESCE(mi.sold_count, 0)::int AS sold_count,
            COALESCE(menu_rating_stats.avg_rating, 0)::numeric(3,2) AS avg_rating
        FROM menu_items mi
        LEFT JOIN (
            SELECT
                ori.menu_item_id,
                ROUND(AVG(ori.rating)::numeric, 2) AS avg_rating,
                COUNT(*)::int AS rating_count
            FROM order_review_items ori
            GROUP BY ori.menu_item_id
        ) menu_rating_stats ON menu_rating_stats.menu_item_id = mi.id
        WHERE mi.is_featured = TRUE AND mi.is_available = TRUE
        ORDER BY mi.price DESC
        LIMIT 3
    `;

    const result = await db.query(query);
    return result.rows;
};

const toggleFeaturedMenuItem = async (id) => {
    const safeId = Number(id);
    if (!Number.isInteger(safeId) || safeId <= 0) {
        throw new Error('Invalid menu item id');
    }

    const result = await db.query(
        `UPDATE menu_items
         SET is_featured = NOT is_featured
         WHERE id = $1
         RETURNING id, is_featured`,
        [safeId]
    );

    return result.rows[0] || null;
};

module.exports = {
    getMenuItems,
    getMenuItemById,
    createMenuItem,
    updateMenuItem,
    getFeaturedMenuItems,
    toggleFeaturedMenuItem
};