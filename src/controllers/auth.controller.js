const authService = require('../services/auth.service');

const loginAdmin = async (req, res) => {
    try {
        const { username, password } = req.body;
        const token = await authService.loginAdmin(username, password);
        if (!token) {
            return res.status(401).json({ error: "Invalid username or password" });
        }
        res.json({
            message: "Login successful",
            token: token
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const registerCustomer = async (req, res) => {
    try {
        const { full_name, phone_number, email, password } = req.body;
        const customerData = { full_name, phone_number, email, password };
        const customerId = await authService.registerCustomer(customerData);
        res.status(201).json({ message: "Customer registered successfully", customerId });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }

        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

const loginCustomer = async (req, res) => {
    try {
        const { email, password } = req.body;
        const token = await authService.loginCustomer(email, password);
        if (!token) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        res.json({
            message: "Login successful",
            token: token
        });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }

        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

const logoutCustomer = async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader)
        return res.sendStatus(400);

    const token = authHeader.split(" ")[1];

    await authService.logoutCustomer(token);

    return res.json({ message: "Logged out" });
};

const getCustomerById = async (req, res) => {
    try {
        const id = req.user.id;
        const data = await authService.getCustomerById(id);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
}

module.exports = {
    loginAdmin,
    registerCustomer,
    loginCustomer,
    logoutCustomer,
    getCustomerById
};