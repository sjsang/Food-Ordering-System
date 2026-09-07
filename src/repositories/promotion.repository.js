const db = require('../config/db');

// lấy tất cả khuyến mãi kèm phạm vi áp dụng (có lọc, sắp xếp, phân trang)
const getPromotions = async ({ search = '', status = 'all', sortBy = 'start_time', sortDir = 'desc', page = 1, limit = 10 } = {}) => {
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offset = (safePage - 1) * safeLimit;

    const params = [];
    const conditions = [];

    if (search) {
        params.push(`%${search}%`);
        conditions.push(`p.name ILIKE $${params.length}`);
    }

    if (status === 'active') {
        conditions.push(`p.is_active = TRUE AND p.start_time <= NOW() AND p.end_time >= NOW()`);
    } else if (status === 'upcoming') {
        conditions.push(`p.is_active = TRUE AND p.start_time > NOW()`);
    } else if (status === 'expired') {
        conditions.push(`p.end_time < NOW()`);
    } else if (status === 'inactive') {
        conditions.push(`p.is_active = FALSE`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortMap = { name: 'p.name', start_time: 'p.start_time', end_time: 'p.end_time', created_at: 'p.created_at' };
    const safeSortBy = sortMap[sortBy] || 'p.start_time';
    const safeSortDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countResult = await db.query(
        `SELECT COUNT(*)::int AS total FROM promotions p ${whereClause}`,
        params
    );
    const totalItems = countResult.rows[0]?.total || 0;

    params.push(safeLimit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const query = `
        SELECT p.*,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', mt.id, 'name', mt.name))
                FILTER (WHERE mt.id IS NOT NULL), '[]'
            ) AS menu_types,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name))
                FILTER (WHERE c.id IS NOT NULL), '[]'
            ) AS categories,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', mi.id, 'name', mi.name))
                FILTER (WHERE mi.id IS NOT NULL), '[]'
            ) AS menu_items
        FROM promotions p
        LEFT JOIN promotion_menu_types pmt ON p.id = pmt.promotion_id
        LEFT JOIN menu_types mt ON pmt.menu_type_id = mt.id
        LEFT JOIN promotion_categories pc ON p.id = pc.promotion_id
        LEFT JOIN categories c ON pc.category_id = c.id
        LEFT JOIN promotion_menu_items pmi ON p.id = pmi.promotion_id
        LEFT JOIN menu_items mi ON pmi.menu_item_id = mi.id
        ${whereClause}
        GROUP BY p.id
        ORDER BY ${safeSortBy} ${safeSortDir}
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const { rows } = await db.query(query, params);
    return {
        data: rows,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalItems,
            totalPages: Math.max(1, Math.ceil(totalItems / safeLimit))
        }
    };
};

const getPromotionById = async (id) => {
    const query = `
        SELECT *
        FROM promotions
        WHERE id = $1
    `;
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const createPromotion = async (promotionData) => {
    try {
        await db.query("BEGIN");

        const {
            name,
            description,
            discount_percent,
            discount_amount,
            start_time,
            end_time,
            applicable_rank,
            menu_type_ids = [],
            category_ids = [],
            menu_item_ids = []
        } = promotionData;

        const promotionQuery = `
            INSERT INTO promotions
            (name, description, discount_percent, discount_amount, start_time, end_time, applicable_rank, image_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id
        `;

        const { rows } = await db.query(promotionQuery, [
            name,
            description,
            discount_percent,
            discount_amount,
            start_time,
            end_time,
            applicable_rank || 'all',
            promotionData.image_url || null
        ]);

        const promotionId = rows[0].id;

        for (const menuTypeId of menu_type_ids) {
            await db.query(
                `INSERT INTO promotion_menu_types (promotion_id, menu_type_id)
                 VALUES ($1,$2)`,
                [promotionId, menuTypeId]
            );
        }

        for (const categoryId of category_ids) {
            await db.query(
                `INSERT INTO promotion_categories (promotion_id, category_id)
                 VALUES ($1,$2)`,
                [promotionId, categoryId]
            );
        }

        for (const menuItemId of menu_item_ids) {
            await db.query(
                `INSERT INTO promotion_menu_items (promotion_id, menu_item_id)
                 VALUES ($1,$2)`,
                [promotionId, menuItemId]
            );
        }

        await db.query("COMMIT");

        return { id: promotionId };

    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const getPromotionByIdFull = async (id) => {
    const query = `
        SELECT p.*,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', mt.id, 'name', mt.name))
                FILTER (WHERE mt.id IS NOT NULL), '[]'
            ) AS menu_types,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name))
                FILTER (WHERE c.id IS NOT NULL), '[]'
            ) AS categories,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', mi.id, 'name', mi.name))
                FILTER (WHERE mi.id IS NOT NULL), '[]'
            ) AS menu_items
        FROM promotions p
        LEFT JOIN promotion_menu_types pmt ON p.id = pmt.promotion_id
        LEFT JOIN menu_types mt ON pmt.menu_type_id = mt.id
        LEFT JOIN promotion_categories pc ON p.id = pc.promotion_id
        LEFT JOIN categories c ON pc.category_id = c.id
        LEFT JOIN promotion_menu_items pmi ON p.id = pmi.promotion_id
        LEFT JOIN menu_items mi ON pmi.menu_item_id = mi.id
        WHERE p.id = $1
        GROUP BY p.id
    `;
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const updatePromotion = async (id, promotionData) => {
    try {
        await db.query("BEGIN");

        const {
            name,
            description,
            discount_percent,
            discount_amount,
            start_time,
            end_time,
            is_active,
            applicable_rank,
            menu_type_ids = [],
            category_ids = [],
            menu_item_ids = []
        } = promotionData;

        const updateQuery = `
            UPDATE promotions
            SET name = $1, description = $2, discount_percent = $3, discount_amount = $4,
                start_time = $5, end_time = $6, is_active = $7, applicable_rank = $8
                ${promotionData.image_url !== undefined ? ', image_url = $10' : ''}
            WHERE id = $9
            RETURNING id
        `;

        const params = [
            name, description, discount_percent, discount_amount,
            start_time, end_time,
            is_active !== undefined ? is_active : true,
            applicable_rank || 'all',
            id
        ];
        if (promotionData.image_url !== undefined) {
            params.push(promotionData.image_url);
        }

        const { rows } = await db.query(updateQuery, params);

        if (rows.length === 0) {
            throw new Error("PROMOTION_NOT_FOUND");
        }

        // Xóa phạm vi cũ
        await db.query(`DELETE FROM promotion_menu_types WHERE promotion_id = $1`, [id]);
        await db.query(`DELETE FROM promotion_categories WHERE promotion_id = $1`, [id]);
        await db.query(`DELETE FROM promotion_menu_items WHERE promotion_id = $1`, [id]);

        // Thêm phạm vi mới
        for (const menuTypeId of menu_type_ids) {
            await db.query(
                `INSERT INTO promotion_menu_types (promotion_id, menu_type_id) VALUES ($1, $2)`,
                [id, menuTypeId]
            );
        }

        for (const categoryId of category_ids) {
            await db.query(
                `INSERT INTO promotion_categories (promotion_id, category_id) VALUES ($1, $2)`,
                [id, categoryId]
            );
        }

        for (const menuItemId of menu_item_ids) {
            await db.query(
                `INSERT INTO promotion_menu_items (promotion_id, menu_item_id) VALUES ($1, $2)`,
                [id, menuItemId]
            );
        }

        await db.query("COMMIT");
        return { id };
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    }
};

const deletePromotion = async (id) => {
    const { rowCount } = await db.query(`DELETE FROM promotions WHERE id = $1`, [id]);
    if (rowCount === 0) {
        throw new Error("PROMOTION_NOT_FOUND");
    }
    return { id };
};

const togglePromotion = async (id) => {
    const { rows } = await db.query(
        `UPDATE promotions SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active`,
        [id]
    );
    if (rows.length === 0) {
        throw new Error("PROMOTION_NOT_FOUND");
    }
    return rows[0];
};

// Lấy khuyến mãi đang hoạt động áp dụng cho danh sách menu_item_ids
const getActivePromotionsForItems = async (menuItemIds, customerRank = 'normal') => {
    if (!menuItemIds || menuItemIds.length === 0) return [];

    const query = `
        SELECT DISTINCT ON (mi_id, p.id)
            p.id AS promotion_id,
            p.name AS promotion_name,
            p.discount_percent,
            p.discount_amount,
            p.applicable_rank,
            src.mi_id AS menu_item_id
        FROM promotions p
        JOIN LATERAL (
            -- Áp dụng cho tất cả (không có scope cụ thể)
            SELECT unnest($1::int[]) AS mi_id
            WHERE NOT EXISTS (SELECT 1 FROM promotion_menu_items WHERE promotion_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM promotion_categories WHERE promotion_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM promotion_menu_types WHERE promotion_id = p.id)
            UNION
            -- Áp dụng trực tiếp cho món
            SELECT pmi.menu_item_id AS mi_id
            FROM promotion_menu_items pmi
            WHERE pmi.promotion_id = p.id AND pmi.menu_item_id = ANY($1)
            UNION
            -- Áp dụng qua danh mục
            SELECT mi.id AS mi_id
            FROM promotion_categories pc
            JOIN menu_items mi ON mi.category_id = pc.category_id
            WHERE pc.promotion_id = p.id AND mi.id = ANY($1)
            UNION
            -- Áp dụng qua loại món
            SELECT mi.id AS mi_id
            FROM promotion_menu_types pmt
            JOIN categories cat ON cat.menu_type_id = pmt.menu_type_id
            JOIN menu_items mi ON mi.category_id = cat.id
            WHERE pmt.promotion_id = p.id AND mi.id = ANY($1)
        ) src ON TRUE
        WHERE p.is_active = TRUE
          AND p.start_time <= NOW()
          AND p.end_time >= NOW()
          AND (p.applicable_rank = 'all' OR p.applicable_rank = $2)
        ORDER BY src.mi_id, p.id
    `;

    const { rows } = await db.query(query, [menuItemIds, customerRank]);
    return rows;
};

module.exports = {
    getPromotions,
    getPromotionById,
    getPromotionByIdFull,
    createPromotion,
    updatePromotion,
    deletePromotion,
    togglePromotion,
    getActivePromotionsForItems
};