const db = require('../config/db');

const getFeaturedReviews = async ({ page = 1, limit = 3 } = {}) => {
    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 20) : 3;
    const offset = (safePage - 1) * safeLimit;

    const countResult = await db.query(
        `SELECT COUNT(*)::int AS total FROM order_reviews WHERE is_featured = TRUE`
    );
    const totalItems = countResult.rows[0]?.total || 0;

    const query = `
        SELECT
            r.id,
            r.rating,
            r.content,
            r.created_at,
            c.full_name AS customer_name,
            c.avatar_url AS customer_avatar,
            o.order_code
        FROM order_reviews r
        JOIN customers c ON c.id = r.customer_id
        JOIN orders o ON o.id = r.order_id
        WHERE r.is_featured = TRUE
        ORDER BY r.created_at DESC
        LIMIT $1 OFFSET $2
    `;

    const result = await db.query(query, [safeLimit, offset]);
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

const getRecentReviews = async (limit = 6) => {
    const safeLimit = Math.min(
        Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 6,
        20
    );

    const query = `
        SELECT
            r.id,
            r.rating,
            r.content,
            r.created_at,
            c.full_name AS customer_name,
            c.avatar_url AS customer_avatar,
            o.order_code
        FROM order_reviews r
        JOIN customers c ON c.id = r.customer_id
        JOIN orders o ON o.id = r.order_id
        ORDER BY r.created_at DESC
        LIMIT $1
    `;

    const result = await db.query(query, [safeLimit]);
    return result.rows;
};

const getReviewsForAdmin = async ({ search = "", rating = "all", featured = "all", page = 1, limit = 10, sortDir = "desc" } = {}) => {
    const params = [];
    const conditions = [];

    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    let fromWhere = `
        FROM order_reviews r
        JOIN customers c ON c.id = r.customer_id
        JOIN orders o ON o.id = r.order_id
    `;

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(o.order_code ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR r.content ILIKE $${params.length})`);
    }

    const parsedRating = Number(rating);
    if (Number.isInteger(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
        params.push(parsedRating);
        conditions.push(`ROUND(r.rating) = $${params.length}`);
    }

    if (featured === "true" || featured === "false") {
        params.push(featured === "true");
        conditions.push(`r.is_featured = $${params.length}`);
    }

    if (conditions.length > 0) {
        fromWhere += ` WHERE ${conditions.join(" AND ")}`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total ${fromWhere}`;
    const countResult = await db.query(countQuery, params);
    const totalItems = countResult.rows[0]?.total || 0;

    params.push(safeLimit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const dataQuery = `
        SELECT
            r.id,
            r.rating,
            r.content,
            r.is_featured,
            r.created_at,
            r.updated_at,
            c.full_name AS customer_name,
            c.phone_number AS customer_phone,
            o.order_code
        ${fromWhere}
        ORDER BY r.created_at ${safeSortDir}, r.id ${safeSortDir}
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await db.query(dataQuery, params);

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

const setFeaturedReview = async (id) => {
    const safeId = Number(id);
    if (!Number.isInteger(safeId) || safeId <= 0) {
        throw new Error('Invalid review id');
    }

    const result = await db.query(
        `UPDATE order_reviews
         SET is_featured = NOT is_featured, updated_at = NOW()
         WHERE id = $1
         RETURNING id, is_featured`,
        [safeId]
    );

    return result.rows[0] || null;
};

module.exports = { getFeaturedReviews, getRecentReviews, getReviewsForAdmin, setFeaturedReview };

