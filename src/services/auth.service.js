const bcrypt = require('bcrypt');
const db = require('../config/db.js');
const { generateToken, verifyToken } = require("../utils/jwt");
const authRepository = require('../repositories/auth.repository');

const createAuthError = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();
const normalizePhone = (phone = "") => String(phone).trim();

const validateRegisterPayload = ({ full_name, phone_number, email, password }) => {
    const sanitizedFullName = String(full_name || "").trim();
    const sanitizedPhone = normalizePhone(phone_number);
    const sanitizedEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!sanitizedFullName || !sanitizedPhone || !sanitizedEmail || !rawPassword) {
        throw createAuthError("Vui lòng điền đầy đủ thông tin.", 400);
    }

    if (sanitizedFullName.length < 2 || sanitizedFullName.length > 100) {
        throw createAuthError("Họ tên phải từ 2 đến 100 ký tự.", 400);
    }

    if (!/^((\+84)|0)(3|5|7|8|9)[0-9]{8}$/.test(sanitizedPhone)) {
        throw createAuthError("Số điện thoại không hợp lệ.", 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
        throw createAuthError("Email không hợp lệ.", 400);
    }

    if (rawPassword.length < 8) {
        throw createAuthError("Mật khẩu phải có ít nhất 8 ký tự.", 400);
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])/.test(rawPassword)) {
        throw createAuthError("Mật khẩu cần chữ hoa, chữ thường, số và ký tự đặc biệt.", 400);
    }

    return {
        full_name: sanitizedFullName,
        phone_number: sanitizedPhone,
        email: sanitizedEmail,
        password: rawPassword
    };
};

const validateLoginPayload = ({ email, password }) => {
    const sanitizedEmail = normalizeEmail(email);
    const rawPassword = String(password || "");

    if (!sanitizedEmail || !rawPassword) {
        throw createAuthError("Vui lòng nhập email và mật khẩu.", 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
        throw createAuthError("Email không hợp lệ.", 400);
    }

    return {
        email: sanitizedEmail,
        password: rawPassword
    };
};

const loginAdmin = async (username, password) => {
    try {
        const admin = await authRepository.loginAdmin(username);
        if (!admin) {
            throw createAuthError('Admin không tồn tại.', 404);
        }
        const isMatch = await bcrypt.compare(password, admin.password_hash);
        if (!isMatch) {
            throw createAuthError('Mật khẩu không chính xác.', 401);
        }

        await db.query(
            `DELETE FROM user_tokens WHERE user_id = $1`,
            [admin.id]
        );

        const token = generateToken({
            id: admin.id,
            role: admin.role,
            username: admin.username
        });
        await db.query(
            `INSERT INTO user_tokens (user_id, token, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '12 hours')`,
            [admin.id, token]
        );
        return token;
    } catch (error) {
        console.error('Error logging in admin:', error);
        throw createAuthError('Không thể đăng nhập admin lúc này.', 500);
    }
};

const hashPassword = async (password) => {
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);
    return hash;
};

const registerCustomer = async (customerData) => {
    try {
        const validated = validateRegisterPayload(customerData);

        const existingEmail = await authRepository.getCustomerByEmail(validated.email);
        if (existingEmail) {
            throw createAuthError("Email đã được sử dụng.", 409);
        }

        const existingPhone = await authRepository.getCustomerByPhone(validated.phone_number);
        if (existingPhone) {
            throw createAuthError("Số điện thoại đã được sử dụng.", 409);
        }

        const password_hash = await hashPassword(validated.password);
        const customerId = await authRepository.registerCustomer({
            full_name: validated.full_name,
            phone_number: validated.phone_number,
            email: validated.email,
            password_hash
        });
        return customerId;
    } catch (error) {
        if (error.status) {
            throw error;
        }

        if (error.code === "23505") {
            throw createAuthError("Thông tin tài khoản đã tồn tại.", 409);
        }

        console.error('Error registering customer:', error);
        throw createAuthError('Không thể đăng ký tài khoản lúc này.', 500);
    }
};

const loginCustomer = async (email, password) => {
    try {
        const validated = validateLoginPayload({ email, password });

        const customer = await authRepository.loginCustomer(validated.email);
        if (!customer) {
            throw createAuthError('Email hoặc mật khẩu không chính xác.', 401);
        }
        const isMatch = await bcrypt.compare(validated.password, customer.password_hash);
        if (!isMatch) {
            throw createAuthError('Email hoặc mật khẩu không chính xác.', 401);
        }

        await db.query(
            `DELETE FROM user_tokens WHERE customer_id = $1`,
            [customer.id]
        );

        const token = generateToken({
            id: customer.id,
            role: 'customer',
        });

        await db.query(
            `INSERT INTO user_tokens (customer_id, token, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '12 hours')`,
            [customer.id, token]
        );

        return token;
    } catch (error) {
        if (error.status) {
            throw error;
        }

        console.error('Error logging in customer:', error);
        throw createAuthError('Không thể đăng nhập lúc này.', 500);
    }
};

const logoutCustomer = async (token) => {
    await db.query(
        `DELETE FROM user_tokens WHERE token = $1`,
        [token]
    );
};

const getCustomerById = async (id) => {
    return await authRepository.getCustomerById(id);
}

module.exports = {
    loginAdmin,
    hashPassword,
    validateRegisterPayload,
    validateLoginPayload,
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    getCustomerById
};