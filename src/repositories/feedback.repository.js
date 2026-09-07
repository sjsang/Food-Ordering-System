const db = require('../config/db');

const createFeedback = async ({ full_name, email, content }) => {
    const result = await db.query(
        `INSERT INTO feedbacks (full_name, email, content) VALUES ($1, $2, $3) RETURNING *`,
        [full_name, email, content]
    );
    return result.rows[0];
};

const getAllFeedbacks = async ({ search = '', is_read = 'all', page = 1, limit = 10, sortDir = 'desc' }) => {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
        conditions.push(`(f.full_name ILIKE $${idx} OR f.email ILIKE $${idx} OR f.content ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
    }

    if (is_read !== 'all') {
        conditions.push(`f.is_read = $${idx}`);
        params.push(is_read === 'true');
        idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

    const countResult = await db.query(`SELECT COUNT(*) FROM feedbacks f ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const offset = (page - 1) * limit;
    const dataResult = await db.query(
        `SELECT * FROM feedbacks f ${where} ORDER BY f.created_at ${dir} LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
    );

    return {
        data: dataResult.rows,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
};

const toggleReadFeedback = async (id) => {
    const result = await db.query(
        `UPDATE feedbacks SET is_read = NOT is_read WHERE id = $1 RETURNING *`,
        [id]
    );
    return result.rows[0];
};

const deleteFeedback = async (id) => {
    const result = await db.query(`DELETE FROM feedbacks WHERE id = $1 RETURNING id`, [id]);
    return result.rows[0];
};

module.exports = { createFeedback, getAllFeedbacks, toggleReadFeedback, deleteFeedback };
