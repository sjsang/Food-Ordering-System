const wardRepository = require("../repositories/ward.repository");

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const parseWardId = (id) => {
    const parsedId = Number(id);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
        throw createHttpError(400, "Ward ID không hợp lệ.");
    }

    return parsedId;
};

const validateWardPayload = (name, shippingFee) => {
    const normalizedName = String(name || "").trim();
    const parsedShippingFee = Number(shippingFee);

    if (!normalizedName) {
        throw createHttpError(400, "Tên phường không được để trống.");
    }

    if (!Number.isFinite(parsedShippingFee) || parsedShippingFee < 0) {
        throw createHttpError(400, "Phí giao hàng phải lớn hơn hoặc bằng 0.");
    }

    return {
        normalizedName,
        parsedShippingFee
    };
};

const mapDatabaseError = (error) => {
    if (error.code === "23505") {
        throw createHttpError(409, "Tên phường đã tồn tại.");
    }

    if (error.code === "23503") {
        throw createHttpError(409, "Không thể xóa phường đang được sử dụng trong địa chỉ khách hàng.");
    }

    throw error;
};

const getWards = async (queryOptions) => {
    return wardRepository.getWards(queryOptions);
};

const createWard = async (name, shippingFee) => {
    const { normalizedName, parsedShippingFee } = validateWardPayload(name, shippingFee);

    try {
        return await wardRepository.createWard(normalizedName, parsedShippingFee);
    } catch (error) {
        mapDatabaseError(error);
    }
};

const updateWard = async (id, name, shippingFee) => {
    const wardId = parseWardId(id);
    const { normalizedName, parsedShippingFee } = validateWardPayload(name, shippingFee);

    try {
        const ward = await wardRepository.updateWard(wardId, normalizedName, parsedShippingFee);

        if (!ward) {
            throw createHttpError(404, "Không tìm thấy phường.");
        }

        return ward;
    } catch (error) {
        mapDatabaseError(error);
    }
};

const deleteWard = async (id) => {
    const wardId = parseWardId(id);

    try {
        const ward = await wardRepository.deleteWard(wardId);

        if (!ward) {
            throw createHttpError(404, "Không tìm thấy phường.");
        }

        return ward;
    } catch (error) {
        mapDatabaseError(error);
    }
};

module.exports = {
    getWards,
    createWard,
    updateWard,
    deleteWard
};