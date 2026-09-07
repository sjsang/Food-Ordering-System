const cartService = require('../services/cart.service');

const getCartItems = async (req, res) => {
    try {
        const userId = req.user.id;
        const data = await cartService.getCartItems(userId);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const addCartItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const { menuItemId, quantity, note } = req.body;
        await cartService.addCartItem(userId, menuItemId, quantity, note);
        res.status(201).json({ message: "Cart item added successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const updateCartItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const menuItemId = req.params.menuItemId || req.body.menuItemId;
        const { quantity, note } = req.body;
        await cartService.updateCartItem(userId, menuItemId, quantity, note);
        res.json({ message: "Cart item updated successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const deleteCartItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const menuItemId = req.params.menuItemId || req.body.menuItemId;
        await cartService.deleteCartItem(userId, menuItemId);
        res.json({ message: "Cart item deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const deleteAllCartItems = async (req, res) => {
    try {
        const userId = req.user.id;
        await cartService.deleteAllCartItems(userId);
        res.json({ message: "All cart items deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = {
    getCartItems,
    addCartItem,
    updateCartItem,
    deleteCartItem,
    deleteAllCartItems,
};