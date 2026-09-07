const { Server } = require("socket.io");
const { verifyToken } = require("../utils/jwt");
const db = require("../config/db");

let io = null;

const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // Xác thực JWT khi kết nối
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("AUTH_REQUIRED"));

        try {
            const decoded = verifyToken(token);

            const result = await db.query(
                `SELECT 1 FROM user_tokens WHERE token = $1 AND expires_at > NOW()`,
                [token]
            );
            if (result.rowCount === 0) return next(new Error("TOKEN_EXPIRED"));

            socket.user = decoded;
            next();
        } catch {
            next(new Error("AUTH_INVALID"));
        }
    });

    io.on("connection", (socket) => {
        const { id, role } = socket.user;

        socket.join(`user:${id}`);

        if (role === "customer") {
            socket.join(`customer:${id}`);
        }

        if (role === "admin" || role === "manager") {
            socket.join("admin_room");
        }

        if (role === "shipper") {
            socket.join(`shipper:${id}`);
        }

        socket.on("chat:join", (conversationId) => {
            socket.join(`chat:${conversationId}`);
        });

        socket.on("chat:leave", (conversationId) => {
            socket.leave(`chat:${conversationId}`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error("Socket.IO not initialized");
    return io;
};

module.exports = { initSocket, getIO };
