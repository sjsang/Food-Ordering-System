const { verifyToken } = require("../utils/jwt.js");
const db = require("../config/db");

const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader)
        return res.sendStatus(401);

    const token = authHeader.split(" ")[1];

    try {
        const decoded = verifyToken(token);

        const result = await db.query(
            `SELECT * FROM user_tokens
             WHERE token = $1
             AND expires_at > NOW()`,
            [token]
        );

        if (result.rowCount === 0)
            return res.sendStatus(401);

        req.user = decoded;

        next();

    } catch (error) {
        return res.sendStatus(403);
    }
};

const optionalAuthenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = verifyToken(token);
        const result = await db.query(
            `SELECT * FROM user_tokens
             WHERE token = $1
             AND expires_at > NOW()`,
            [token]
        );

        if (result.rowCount > 0) {
            req.user = decoded;
        }
    } catch {
        req.user = null;
    }

    next();
};

const requireRole = (role) => {
    return (req, res, next) => {
        if (req.user?.role !== role) {
            return res.sendStatus(403);
        }

        next();
    };
};

const requireAnyRole = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.sendStatus(403);
        }

        next();
    };
};

module.exports = {
    authenticate,
    optionalAuthenticate,
    requireRole,
    requireAnyRole
}