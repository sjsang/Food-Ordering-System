const db = require('../config/db');

const VALID_PAYMENT_METHODS = new Set(['cash', 'transfer', 'vnpay']);

const getPaymentByOrderId = async (orderId, client = db) => {
    const query = `SELECT * FROM payments WHERE order_id = $1`;
    const result = await client.query(query, [orderId]);
    return result.rows[0];
};

const createPayment = async (orderId, method, amount) => {
    if (!VALID_PAYMENT_METHODS.has(method)) {
        throw new Error('INVALID_PAYMENT_METHOD');
    }

    const query = `INSERT INTO payments (order_id, method, amount) VALUES ($1, $2, $3) RETURNING *`;
    const values = [orderId, method, amount];
    const result = await db.query(query, values);
    return result.rows[0];
};

const markCashPaymentPaid = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'paid',
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
            WHERE order_id = $1
              AND method = 'cash'
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

const markTransferPaymentPaid = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'paid',
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
            WHERE order_id = $1
              AND method = 'transfer'
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

const markVnpayPaymentPaid = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'paid',
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
            WHERE order_id = $1
              AND method = 'vnpay'
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

const markOrderPaymentFailed = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'failed',
                paid_at = NULL
            WHERE order_id = $1
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

const markOrderPaymentRefunded = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'refunded'
            WHERE order_id = $1
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

const saveRefundRequestInfo = async (orderId, refundInfo, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET refund_bank_name = $2,
                refund_account_number = $3,
                refund_account_name = $4,
                refund_note = $5,
                refund_requested_at = CURRENT_TIMESTAMP
            WHERE order_id = $1
            RETURNING *
        `,
        [
            orderId,
            refundInfo.bankName,
            refundInfo.accountNumber,
            refundInfo.accountName,
            refundInfo.note || null
        ]
    );

    return result.rows[0] || null;
};

const markOrderPaymentRefundedByAdmin = async (orderId, client = db) => {
    const result = await client.query(
        `
            UPDATE payments
            SET payment_status = 'refunded',
                refund_marked_at = CURRENT_TIMESTAMP
            WHERE order_id = $1
            RETURNING *
        `,
        [orderId]
    );

    return result.rows[0] || null;
};

module.exports = {
    getPaymentByOrderId,
    createPayment,
    markCashPaymentPaid,
    markTransferPaymentPaid,
    markVnpayPaymentPaid,
    markOrderPaymentFailed,
    markOrderPaymentRefunded,
    saveRefundRequestInfo,
    markOrderPaymentRefundedByAdmin
};