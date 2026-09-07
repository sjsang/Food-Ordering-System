const userService = require("../services/user.service");

const getUsers = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            role: String(req.query.role || "all").trim(),
            isActive: String(req.query.isActive || "all").trim(),
            sortBy: String(req.query.sortBy || "created_at").trim(),
            sortDir: String(req.query.sortDir || "desc").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 5)
        };

        const result = await userService.getUsers(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
};

const createUserByAdmin = async (req, res) => {
    try {
        const { username, password, full_name, phone_number, role } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập username, mật khẩu và vai trò"
            });
        }

        if (!["admin", "shipper"].includes(role)) {
            return res.status(400).json({ success: false, message: "Vai trò không hợp lệ" });
        }

        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }

        const user = await userService.createUserByAdmin({
            username: String(username).trim(),
            password: String(password),
            full_name: full_name ? String(full_name).trim() : null,
            phone_number: phone_number ? String(phone_number).trim() : null,
            role
        });

        res.status(201).json({ success: true, data: user });
    } catch (error) {
        if (error?.code === "23505") {
            return res.status(409).json({ success: false, message: "Username đã tồn tại" });
        }
        console.error("Error creating user:", error);
        res.status(500).json({ success: false, message: "Failed to create user" });
    }
};

const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const [user, assignedOrders] = await Promise.all([
            userService.getUserById(id),
            userService.getAssignedOrders(id)
        ]);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({
            success: true,
            data: {
                ...user,
                assigned_orders: assignedOrders
            }
        });
    } catch (error) {
        console.error("Error fetching user detail:", error);
        res.status(500).json({ success: false, message: "Failed to fetch user" });
    }
};

const getMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await userService.getMyProfile(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error("Error fetching my profile:", error);
        res.status(500).json({ success: false, message: "Failed to fetch profile" });
    }
};

const toggleUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userService.toggleUserStatus(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error("Error toggling user status:", error);
        res.status(500).json({ success: false, message: "Failed to toggle user status" });
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone_number, role, password } = req.body;

        if (!role) {
            return res.status(400).json({ success: false, message: "Vai trò không được để trống" });
        }

        const user = await userService.updateUser(id, { full_name, phone_number, role, password });
        if (!user) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        if (error?.message === "PASSWORD_TOO_SHORT") {
            return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }
        if (error?.message === "INVALID_ROLE") {
            return res.status(400).json({ success: false, message: "Vai trò không hợp lệ" });
        }
        console.error("Error updating user:", error);
        res.status(500).json({ success: false, message: "Failed to update user" });
    }
};

const updateMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { full_name, phone_number, password } = req.body;

        const user = await userService.updateMyProfile(userId, { full_name, phone_number, password });
        if (!user) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        if (error?.message === "PASSWORD_TOO_SHORT") {
            return res.status(400).json({ success: false, message: "Mật khẩu phải có ít nhất 6 ký tự" });
        }
        console.error("Error updating my profile:", error);
        res.status(500).json({ success: false, message: "Failed to update profile" });
    }
};

const updateMyAvatar = async (req, res) => {
    try {
        const userId = req.user.id;
        const avatarFile = req.file;

        const user = await userService.updateMyAvatar(userId, avatarFile);
        if (!user) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        if (error?.message === "AVATAR_FILE_REQUIRED") {
            return res.status(400).json({ success: false, message: "Vui lòng chọn ảnh đại diện" });
        }
        console.error("Error updating my avatar:", error);
        res.status(500).json({ success: false, message: "Failed to update avatar" });
    }
};

const deleteMyAvatar = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await userService.deleteMyAvatar(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
        }
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error("Error deleting my avatar:", error);
        res.status(500).json({ success: false, message: "Failed to delete avatar" });
    }
};

module.exports = {
    getUsers,
    createUserByAdmin,
    getUserById,
    getMyProfile,
    toggleUserStatus,
    updateUser,
    updateMyProfile,
    updateMyAvatar,
    deleteMyAvatar
};