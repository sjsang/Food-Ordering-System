const customerRepository = require('../repositories/customer.repository');
const bcrypt = require('bcrypt');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

const getCustomers = async (queryOptions) => {
    return await customerRepository.getCustomers(queryOptions);
};

const createCustomerByAdmin = async (customerData) => {
    const password_hash = await bcrypt.hash(customerData.password, 10);
    return await customerRepository.createCustomerByAdmin({
        ...customerData,
        password_hash
    });
};

const updateCustomer = async (id, name, email, phone) => {
    return await customerRepository.updateCustomer(id, name, email, phone);
};

const updateCustomerByAdmin = async (id, { full_name, phone_number, email, password }) => {
    let password_hash = null;
    if (password && String(password).length > 0) {
        if (String(password).length < 6) {
            throw new Error('PASSWORD_TOO_SHORT');
        }
        password_hash = await bcrypt.hash(String(password), 10);
    }

    return await customerRepository.updateCustomerByAdmin(id, {
        full_name: String(full_name || '').trim(),
        phone_number: String(phone_number || '').trim(),
        email: email ? String(email).trim() : '',
        password_hash
    });
};

const updateCustomerAvatar = async (id, avatarFile) => {
    if (!avatarFile) {
        throw new Error('AVATAR_FILE_REQUIRED');
    }

    // Get current avatar to destroy old one on Cloudinary
    const currentCustomer = await customerRepository.getCustomerById(id);
    if (currentCustomer?.avatar_url && currentCustomer.avatar_url !== 'no-avatar_hblnf5') {
        try {
            await cloudinary.uploader.destroy(currentCustomer.avatar_url);
        } catch (err) {
            console.error('Failed to destroy old avatar on Cloudinary:', err.message);
        }
    }

    const uploadResult = await cloudinary.uploader.upload(avatarFile.path, {
        folder: 'CADAO/avatars/customers',
        resource_type: 'image'
    });

    fs.unlinkSync(avatarFile.path);

    return await customerRepository.updateCustomerAvatar(id, uploadResult.public_id);
};

const deleteCustomerAvatar = async (id) => {
    const currentCustomer = await customerRepository.getCustomerById(id);
    if (currentCustomer?.avatar_url && currentCustomer.avatar_url !== 'no-avatar_hblnf5') {
        try {
            await cloudinary.uploader.destroy(currentCustomer.avatar_url);
        } catch (err) {
            console.error('Failed to destroy avatar on Cloudinary:', err.message);
        }
    }

    return await customerRepository.updateCustomerAvatar(id, 'no-avatar_hblnf5');
};

// Address Management
const getCustomerAddresses = async (customerId) => {
    return await customerRepository.getCustomerAddresses(customerId);
};

const addCustomerAddress = async (customerId, addressLine, wardId) => {
    return await customerRepository.addCustomerAddress(customerId, addressLine, wardId);
};

const updateCustomerAddress = async (addressId, addressLine, wardId) => {
    return await customerRepository.updateCustomerAddress(addressId, addressLine, wardId);
};

const deleteCustomerAddress = async (addressId) => {
    return await customerRepository.deleteCustomerAddress(addressId);
};

const setDefaultAddress = async (customerId, addressId) => {
    return await customerRepository.setDefaultAddress(customerId, addressId);
};

const getCustomerById = async (id) => {
    return await customerRepository.getCustomerById(id);
};

const toggleCustomerStatus = async (id) => {
    return await customerRepository.toggleCustomerStatus(id);
};

const getCustomerOrders = async (customerId) => {
    return await customerRepository.getCustomerOrders(customerId);
};

const getCustomerAddressesByAdmin = async (customerId) => {
    return await customerRepository.getCustomerAddressesByAdmin(customerId);
};

const RANK_THRESHOLD = 10000000; // 10 triệu VNĐ

const getCustomerRank = async (customerId) => {
    const customer = await customerRepository.getCustomerById(customerId);
    const rank = customer?.rank || 'normal';
    const totalSpent = Number(customer?.total_spent || 0);
    return {
        rank,
        rank_name: rank === 'loyal' ? 'Khách hàng thân quen' : 'Khách hàng mới',
        total_spent: totalSpent,
        threshold: RANK_THRESHOLD,
        remaining: Math.max(0, RANK_THRESHOLD - totalSpent)
    };
};

const recalcAndUpdateRank = async (customerId) => {
    const totalSpent = await customerRepository.getCustomerTotalSpent(customerId);
    const rank = totalSpent >= RANK_THRESHOLD ? 'loyal' : 'normal';
    await customerRepository.updateCustomerRank(customerId, rank, totalSpent);
    return { rank, totalSpent };
};

module.exports = {
    getCustomers,
    createCustomerByAdmin,
    updateCustomer,
    updateCustomerByAdmin,
    updateCustomerAvatar,
    deleteCustomerAvatar,
    getCustomerAddresses,
    addCustomerAddress,
    updateCustomerAddress,
    deleteCustomerAddress,
    setDefaultAddress,
    getCustomerById,
    toggleCustomerStatus,
    getCustomerOrders,
    getCustomerAddressesByAdmin,
    getCustomerRank,
    recalcAndUpdateRank,
    RANK_THRESHOLD
};