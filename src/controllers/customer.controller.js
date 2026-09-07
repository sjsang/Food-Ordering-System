const customerService = require('../services/customer.service');

const getCustomers = async (req, res) => {
    try {
        const queryOptions = {
            search: String(req.query.search || "").trim(),
            isActive: String(req.query.isActive || "all").trim(),
            sortBy: String(req.query.sortBy || "created_at").trim(),
            sortDir: String(req.query.sortDir || "desc").trim(),
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 5)
        };

        const result = await customerService.getCustomers(queryOptions);
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    }
    catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ success: false, message: "Failed to fetch customers" });
    }
};

const createCustomerByAdmin = async (req, res) => {
    try {
        const { full_name, phone_number, email, password } = req.body;

        if (!full_name || !phone_number || !password) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập đầy đủ họ tên, số điện thoại và mật khẩu"
            });
        }

        if (String(password).length < 6) {
            return res.status(400).json({
                success: false,
                message: "Mật khẩu phải có ít nhất 6 ký tự"
            });
        }

        const customer = await customerService.createCustomerByAdmin({
            full_name: String(full_name).trim(),
            phone_number: String(phone_number).trim(),
            email: email ? String(email).trim() : null,
            password: String(password)
        });

        res.status(201).json({ success: true, data: customer });
    }
    catch (error) {
        if (error?.code === '23505') {
            return res.status(409).json({ success: false, message: 'Email đã tồn tại' });
        }
        console.error("Error creating customer by admin:", error);
        res.status(500).json({ success: false, message: "Failed to create customer" });
    }
};

const updateCustomer = async (req, res) => {
    try {
        const id = req.user.id;
        const { name, email, phone } = req.body;
        const data = await customerService.updateCustomer(id, name, email, phone);
        res.json(data);
    }
    catch (error) {
        console.error("Error updating customer:", error);
        res.status(500).json({ error: "An error occurred while updating the customer." });
    }
};

const updateCustomerByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone_number, email, password } = req.body;

        if (!full_name || !phone_number) {
            return res.status(400).json({ success: false, message: 'Họ tên và số điện thoại không được để trống' });
        }

        const customer = await customerService.updateCustomerByAdmin(id, { full_name, phone_number, email, password });
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Khách hàng không tồn tại' });
        }

        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        if (error?.message === 'PASSWORD_TOO_SHORT') {
            return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự' });
        }
        if (error?.code === '23505') {
            return res.status(409).json({ success: false, message: 'Email đã tồn tại' });
        }
        console.error('Error updating customer by admin:', error);
        res.status(500).json({ success: false, message: 'Failed to update customer' });
    }
};

// Address Management
const getAddresses = async (req, res) => {
    try {
        const customerId = req.user.id;
        const addresses = await customerService.getCustomerAddresses(customerId);
        res.status(200).json({ success: true, data: addresses });
    }
    catch (error) {
        console.error("Error fetching addresses:", error);
        res.status(500).json({ success: false, message: "Failed to fetch addresses" });
    }
};

const addAddress = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { addressLine, wardId } = req.body;

        if (!addressLine || !wardId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const address = await customerService.addCustomerAddress(customerId, addressLine, wardId);
        res.status(201).json({ success: true, data: address });
    }
    catch (error) {
        console.error("Error adding address:", error);
        res.status(500).json({ success: false, message: "Failed to add address" });
    }
};

const updateAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const { addressLine, wardId } = req.body;

        if (!addressLine || !wardId) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const address = await customerService.updateCustomerAddress(id, addressLine, wardId);
        res.status(200).json({ success: true, data: address });
    }
    catch (error) {
        console.error("Error updating address:", error);
        res.status(500).json({ success: false, message: "Failed to update address" });
    }
};

const deleteAddress = async (req, res) => {
    try {
        const { id } = req.params;
        await customerService.deleteCustomerAddress(id);
        res.status(200).json({ success: true, message: "Address deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting address:", error);
        res.status(500).json({ success: false, message: "Failed to delete address" });
    }
};

const setDefaultAddress = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { addressId } = req.body;

        if (!addressId) {
            return res.status(400).json({ success: false, message: "Address ID is required" });
        }

        const address = await customerService.setDefaultAddress(customerId, addressId);
        res.status(200).json({ success: true, data: address });
    }
    catch (error) {
        console.error("Error setting default address:", error);
        res.status(500).json({ success: false, message: "Failed to set default address" });
    }
};

const getCustomerById = async (req, res) => {
    try {
        const { id } = req.params;
        const [customer, addresses, orders] = await Promise.all([
            customerService.getCustomerById(id),
            customerService.getCustomerAddressesByAdmin(id),
            customerService.getCustomerOrders(id)
        ]);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        res.status(200).json({ success: true, data: { ...customer, addresses, orders } });
    } catch (error) {
        console.error('Error fetching customer detail:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customer' });
    }
};

const toggleCustomerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const customer = await customerService.toggleCustomerStatus(id);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        console.error('Error toggling customer status:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle customer status' });
    }
};

const updateCustomerAvatar = async (req, res) => {
    try {
        const id = req.user.id;
        const avatarFile = req.file;
        const customer = await customerService.updateCustomerAvatar(id, avatarFile);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Khách hàng không tồn tại' });
        }

        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        if (error?.message === 'AVATAR_FILE_REQUIRED') {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ảnh đại diện' });
        }
        console.error('Error updating customer avatar:', error);
        res.status(500).json({ success: false, message: 'Failed to update avatar' });
    }
};

const deleteCustomerAvatar = async (req, res) => {
    try {
        const id = req.user.id;
        const customer = await customerService.deleteCustomerAvatar(id);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Khách hàng không tồn tại' });
        }
        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        console.error('Error deleting customer avatar:', error);
        res.status(500).json({ success: false, message: 'Failed to delete avatar' });
    }
};

const getMyRank = async (req, res) => {
    try {
        const customerId = req.user.id;
        const rankInfo = await customerService.getCustomerRank(customerId);
        res.status(200).json({ success: true, data: rankInfo });
    } catch (error) {
        console.error('Error fetching customer rank:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch rank info' });
    }
};

module.exports = {
    getCustomers,
    createCustomerByAdmin,
    updateCustomer,
    updateCustomerByAdmin,
    updateCustomerAvatar,
    deleteCustomerAvatar,
    getAddresses,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    getCustomerById,
    toggleCustomerStatus,
    getMyRank
};