const cartRepository = require('../repositories/cart.repository');

const getCartItems = async (userId) => {
    return await cartRepository.getCartItems(userId);
};

const addCartItem = async (userId, menuItemId, quantity, note) => {
    await cartRepository.addCartItem(userId, menuItemId, quantity, note);
};

const updateCartItem = async (userId, menuItemId, quantity, note) => {
    await cartRepository.updateCartItem(userId, menuItemId, quantity, note);
};

const deleteCartItem = async (userId, menuItemId) => {
    await cartRepository.deleteCartItem(userId, menuItemId);
};

const deleteAllCartItems = async (userId) => {
    await cartRepository.deleteAllCartItems(userId);
};

module.exports = {
    getCartItems,
    addCartItem,
    updateCartItem,
    deleteCartItem,
    deleteAllCartItems
};