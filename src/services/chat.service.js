const OpenAI = require("openai");
const chatRepository = require("../repositories/chat.repository");
const cartRepository = require("../repositories/cart.repository");
const orderRepository = require("../repositories/order.repository");
const { getDeliveryPrediction } = require("../utils/deliveryPrediction");

const AI_MODEL = process.env.AI_CHAT_MODEL || "openai/gpt-4o-mini";
const AI_TIMEOUT_MS = 15_000;
const HISTORY_LIMIT = 8;
const FALLBACK_MSG = "Xin lỗi bạn, mình đang gặp sự cố nhỏ. Bạn vui lòng thử lại nhé!";

const createHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const getOpenAIClient = () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return null;
    }

    return new OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1"
    });
};

const removeAccents = (str) =>
    String(str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim();

const callAI = async (payload) => {
    const client = getOpenAIClient();
    if (!client) {
        throw createHttpError(500, "OPENAI_API_KEY chưa được cấu hình.");
    }

    return Promise.race([
        client.chat.completions.create(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AI request timed out")), AI_TIMEOUT_MS))
    ]);
};

const SYSTEM_PROMPT = `Bạn là trợ lý AI thông minh của nhà hàng Ca Dao, có thể tư vấn và hoàn thành đặt hàng cho khách.

THÔNG TIN NHÀ HÀNG:
- Tên: Nhà hàng Ca Dao
- Giờ mở cửa: 6:00 - 22:00 hàng ngày
- Địa chỉ: 02 Phan Văn Trị, Ninh Kiều, Cần Thơ (cạnh công viên Lưu Hữu Phước)
- Hotline: 090 103 39 99
- Phí giao hàng: Tùy theo phường (trung bình 15.000 - 30.000 VND)

QUY TẮC GIAO TIẾP:
- Luôn bắt đầu bằng "dạ".
- Xưng "tôi", gọi khách là "quý khách".
- Trả lời ngắn gọn, rõ ràng, tối đa 4-6 dòng.
- Không bịa thông tin món ăn, giá, voucher.
- Khách hỏi những vấn đề ngoài thực đơn/đặt hàng: trả lời lịch sự, gợi ý khách nhấn nút gọi nhân viên/liên hệ hotline hoặc đến trực tiếp nhà hàng.

KHI TƯ VẤN THỰC ĐƠN:
- Khách tìm món theo tên / từ khóa: dùng tool search_menu_items.
- Khách lọc theo danh mục, loại món, khoảng giá, món nổi bật (best seller), bán chạy: dùng tool filter_menu_items.
- Khách hỏi món rẻ nhất hoặc đắt nhất: dùng tool get_menu_items_by_price.
- Khách hỏi khuyến mãi / ưu đãi / mã / voucher: dùng tool get_promotions.
- Khách muốn thêm món vào giỏ: dùng tool add_to_cart_item (hỗ trợ số lượng và ghi chú).
- Khách muốn sửa số lượng/ghi chú món trong giỏ: dùng tool update_cart_item.
- Khách muốn xóa món khỏi giỏ: dùng tool remove_cart_item.
- Khách hỏi "trước mình hay gọi gì" / gợi ý: dùng tool get_order_history.

KHI THEO DÕI ĐƠN HÀNG:
- Khách hỏi đơn hàng / giao đến đâu: dùng tool track_orders.

KHI ĐẶT HÀNG (quy trình hoàn chỉnh):
1. Khách muốn xem giỏ hàng: dùng tool view_cart.
2. Khách muốn biết địa chỉ giao hàng: dùng tool get_delivery_info.
3. Khi khách muốn đặt hàng:
   - Dùng tool view_cart để kiểm tra giỏ hàng.
   - Hỏi khách có mã voucher không (nếu chưa đề cập).
   - Hỏi khách có ghi chú gì cho đơn không.
   - Dùng tool place_order để hoàn tất đơn hàng.
   - Sau khi đặt thành công: thông báo mã đơn, tạm tính (subtotal), giảm giá khuyến mãi (promotionDiscount), giảm giá voucher (voucherDiscount), phí ship, tổng thanh toán (totalAmount), địa chỉ giao.
   - Nếu có giảm giá (promotionDiscount > 0 hoặc voucherDiscount > 0): liệt kê rõ từng khoản giảm.
4. Nếu khách chưa có địa chỉ mặc định: hướng dẫn vào mục "Địa chỉ" ở trang cá nhân để thêm.
5. Đơn hàng đặt qua chatbot sẽ thanh toán khi nhận hàng (COD).

XỬ LÝ TỒN KHO:
- is_available = false: báo món tạm hết, gợi ý món khác nếu có.

ĐỊNH DẠNG:
- Liệt kê ngắn dạng gạch đầu dòng, mỗi món/mã 1 dòng.
- Giá hiển thị theo VND.`;

const tools = [
    {
        type: "function",
        function: {
            name: "search_menu_items",
            description: "Tìm món theo tên, mô tả, danh mục, loại món.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Từ khóa tìm món" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_menu_items_by_price",
            description: "Lấy món rẻ nhất hoặc đắt nhất, có thể lọc theo loại (Đồ ăn/Đồ uống) hoặc danh mục.",
            parameters: {
                type: "object",
                properties: {
                    sort: {
                        type: "string",
                        enum: ["asc", "desc"],
                        description: "asc = rẻ nhất, desc = đắt nhất"
                    },
                    limit: {
                        type: "number",
                        description: "Số lượng món cần lấy"
                    },
                    menuType: {
                        type: "string",
                        description: "Loại (VD: món ăn, món uống)"
                    },
                    category: {
                        type: "string",
                        description: "Danh mục (VD: món kho, nước ép, cà phê...)"
                    }
                },
                required: ["sort"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_promotions",
            description: "Lấy danh sách voucher và chương trình khuyến mãi đang hoạt động.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_order_history",
            description: "Lấy lịch sử đơn hàng gần đây của khách hàng để gợi ý món.",
            parameters: {
                type: "object",
                properties: {
                    limit: {
                        type: "number",
                        description: "Số đơn cần lấy (mặc định 5)"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "track_orders",
            description: "Xem trạng thái đơn hàng đang xử lý của khách.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "add_to_cart_item",
            description: "Thêm món ăn vào giỏ hàng cho khách.",
            parameters: {
                type: "object",
                properties: {
                    itemName: {
                        type: "string",
                        description: "Tên món ăn cần thêm"
                    },
                    quantity: {
                        type: "number",
                        description: "Số lượng (mặc định 1)"
                    },
                    note: {
                        type: "string",
                        description: "Ghi chú cho món (VD: ít cay, không hành, thêm rau...)"
                    }
                },
                required: ["itemName"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "view_cart",
            description: "Xem giỏ hàng hiện tại của khách, bao gồm danh sách món và tổng tiền.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_delivery_info",
            description: "Lấy thông tin địa chỉ giao hàng mặc định của khách hàng.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "place_order",
            description: "Đặt hàng hoàn chỉnh từ giỏ hàng hiện tại của khách (thanh toán COD). Gọi sau khi đã xác nhận giỏ hàng và địa chỉ với khách.",
            parameters: {
                type: "object",
                properties: {
                    voucherCode: {
                        type: "string",
                        description: "Mã voucher áp dụng (tuỳ chọn)"
                    },
                    notes: {
                        type: "string",
                        description: "Ghi chú cho đơn hàng (tuỳ chọn)"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "filter_menu_items",
            description: "Lọc món ăn theo nhiều tiêu chí: danh mục, loại món, khoảng giá, món nổi bật (best seller), bán chạy.",
            parameters: {
                type: "object",
                properties: {
                    category: { type: "string", description: "Tên danh mục (VD: món kho, món chiên...)" },
                    menuType: { type: "string", description: "Tên loại (VD: món ăn, món uống...)" },
                    minPrice: { type: "number", description: "Giá tối thiểu (VND)" },
                    maxPrice: { type: "number", description: "Giá tối đa (VND)" },
                    isFeatured: { type: "boolean", description: "Chỉ lấy món nổi bật (đặc sản nhà hàng)" },
                    sortBy: {
                        type: "string",
                        enum: ["price_asc", "price_desc", "bestseller", "newest", "name"],
                        description: "Cách sắp xếp kết quả"
                    },
                    limit: { type: "number", description: "Số lượng kết quả (mặc định 10, tối đa 20)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_cart_item",
            description: "Cập nhật số lượng hoặc ghi chú của một món đã có trong giỏ hàng.",
            parameters: {
                type: "object",
                properties: {
                    itemName: { type: "string", description: "Tên món cần cập nhật" },
                    quantity: { type: "number", description: "Số lượng mới" },
                    note: { type: "string", description: "Ghi chú mới cho món" }
                },
                required: ["itemName"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "remove_cart_item",
            description: "Xóa một món khỏi giỏ hàng.",
            parameters: {
                type: "object",
                properties: {
                    itemName: { type: "string", description: "Tên món cần xóa khỏi giỏ" }
                },
                required: ["itemName"]
            }
        }
    }
];

const executeSearchMenuItems = async (query) => {
    const keyword = String(query || "").trim();
    if (!keyword) {
        return JSON.stringify({ message: "Từ khóa tìm kiếm trống." });
    }

    const normalized = removeAccents(keyword);
    const rows = await chatRepository.searchMenuItemsWithImage(keyword, 5);
    const fallbackRows = normalized && normalized !== keyword
        ? await chatRepository.searchMenuItemsWithImage(normalized, 5)
        : [];

    const merged = [...rows];
    fallbackRows.forEach((item) => {
        if (!merged.some((existing) => Number(existing.id) === Number(item.id))) {
            merged.push(item);
        }
    });

    if (merged.length === 0) {
        return JSON.stringify({ message: `Không tìm thấy món phù hợp với từ khóa "${keyword}".` });
    }

    return JSON.stringify(
        merged.slice(0, 5).map((item) => ({
            name: item.name,
            price: item.price,
            category: item.category_name,
            menuType: item.menu_type_name,
            soldCount: item.sold_count,
            isAvailable: item.is_available,
            imageUrl: item.image_url || null,
            description: String(item.description || "").slice(0, 150)
        }))
    );
};

const executeGetMenuItemsByPrice = async (sort = "asc", limit = 1, menuType, category) => {
    const items = await chatRepository.getMenuItemsByPrice({ sort, limit, menuType, category });
    if (items.length === 0) {
        return JSON.stringify({ message: "Hiện không có món phù hợp." });
    }

    return JSON.stringify(
        items.map((item) => ({
            name: item.name,
            price: item.price,
            category: item.category_name,
            menuType: item.menu_type_name,
            soldCount: item.sold_count,
            isAvailable: item.is_available
        }))
    );
};

const executeGetPromotions = async () => {
    const vouchers = await chatRepository.getActiveVouchers();
    const promotions = await chatRepository.getActivePromotions();
    if (vouchers.length === 0 && promotions.length === 0) {
        return JSON.stringify({ message: "Hiện chưa có voucher hoặc chương trình khuyến mãi nào đang hoạt động." });
    }

    return JSON.stringify({
        message: "Danh sách voucher và chương trình khuyến mãi hiện tại",
        vouchers: vouchers.map((v) => ({
            code: v.code,
            discountPercent: v.discount_percent,
            discountAmount: v.discount_amount,
            minOrderValue: v.min_order_value,
            maxDiscount: v.max_discount,
            remainingUsage: v.usage_limit === null ? null : Number(v.usage_limit) - Number(v.used_count || 0),
            expiryDate: v.expiry_date
        })),
        promotions: promotions.map((p) => ({
            id: p.id,
            title: p.name,
            description: p.description,
            discountPercent: p.discount_percent,
            discountAmount: p.discount_amount,
            startTime: p.start_time,
            endTime: p.end_time
        }))
    });
};

const executeGetOrderHistory = async (customerId, limit = 5) => {
    const orders = await chatRepository.getCustomerOrderHistory(customerId, limit);
    if (orders.length === 0) {
        return JSON.stringify({ message: "Khách chưa có đơn hàng nào trước đây." });
    }

    return JSON.stringify({
        message: `${orders.length} đơn hàng gần nhất`,
        orders: orders.map((o) => ({
            orderCode: o.order_code,
            status: o.status,
            totalAmount: o.total_amount,
            date: o.created_at,
            items: o.items
        }))
    });
};

const executeTrackOrders = async (customerId) => {
    const orders = await chatRepository.getCustomerActiveOrders(customerId);
    if (orders.length === 0) {
        return JSON.stringify({ message: "Hiện không có đơn hàng nào đang xử lý." });
    }

    const statusMap = {
        pending: "Chờ xác nhận",
        confirmed: "Đã xác nhận",
        preparing: "Đang chuẩn bị",
        shipping: "Đang giao hàng"
    };

    return JSON.stringify({
        message: `${orders.length} đơn hàng đang xử lý`,
        orders: orders.map((o) => ({
            orderCode: o.order_code,
            status: statusMap[o.status] || o.status,
            totalAmount: o.total_amount,
            address: o.delivery_address,
            ward: o.delivery_ward_name,
            shippingFee: o.shipping_fee,
            shipperName: o.shipper_name || null,
            shipperPhone: o.shipper_phone || null,
            updatedAt: o.updated_at
        }))
    });
};

const executeAddToCart = async (customerId, itemName, quantity = 1, note = null) => {
    const menuItem = await chatRepository.findMenuItemByName(itemName);
    if (!menuItem) {
        return JSON.stringify({ success: false, message: `Không tìm thấy món "${itemName}".` });
    }

    if (!menuItem.is_available) {
        return JSON.stringify({ success: false, message: `Món "${menuItem.name}" hiện tạm hết.` });
    }

    const safeQty = Math.max(1, Math.min(Number(quantity) || 1, 20));
    const safeNote = note ? String(note).trim().slice(0, 200) : null;
    await cartRepository.addCartItem(customerId, menuItem.id, safeQty, safeNote);

    const noteInfo = safeNote ? ` (ghi chú: ${safeNote})` : "";
    return JSON.stringify({
        success: true,
        message: `Đã thêm ${safeQty}x "${menuItem.name}" (${Number(menuItem.price).toLocaleString("vi-VN")} VND) vào giỏ hàng${noteInfo}.`
    });
};

const executeViewCart = async (customerId) => {
    const { items, totalCart } = await cartRepository.getCartItems(customerId);
    if (!items || items.length === 0) {
        return JSON.stringify({ message: "Giỏ hàng của bạn đang trống." });
    }

    return JSON.stringify({
        items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: Number(item.price) * Number(item.quantity),
            note: item.note || null
        })),
        totalCart: Number(totalCart)
    });
};

const executeFilterMenuItems = async ({ category, menuType, minPrice, maxPrice, isFeatured, sortBy, limit } = {}) => {
    const items = await chatRepository.getMenuItemsByFilter({
        category, menuType, minPrice, maxPrice,
        isFeatured, isAvailable: true, sortBy, limit
    });

    if (items.length === 0) {
        return JSON.stringify({ message: "Không tìm thấy món phù hợp với bộ lọc." });
    }

    return JSON.stringify(
        items.map((item) => ({
            name: item.name,
            price: item.price,
            category: item.category_name,
            menuType: item.menu_type_name,
            soldCount: item.sold_count,
            isAvailable: item.is_available,
            isFeatured: item.is_featured,
            imageUrl: item.image_url || null,
            description: String(item.description || "").slice(0, 150)
        }))
    );
};

const executeUpdateCartItem = async (customerId, itemName, quantity, note) => {
    const menuItem = await chatRepository.findMenuItemByName(itemName);
    if (!menuItem) {
        return JSON.stringify({ success: false, message: `Không tìm thấy món "${itemName}".` });
    }

    const { items } = await cartRepository.getCartItems(customerId);
    const currentItem = items.find((i) => Number(i.menu_item_id) === Number(menuItem.id));
    if (!currentItem) {
        return JSON.stringify({ success: false, message: `Món "${menuItem.name}" không có trong giỏ hàng.` });
    }

    const newQty = quantity != null ? Math.max(1, Math.min(Number(quantity) || 1, 20)) : currentItem.quantity;
    const newNote = note !== undefined && note !== null ? String(note).trim().slice(0, 200) || null : (currentItem.note || null);

    await cartRepository.updateCartItem(customerId, menuItem.id, newQty, newNote);

    return JSON.stringify({
        success: true,
        message: `Đã cập nhật "${menuItem.name}": ${newQty} phần${newNote ? `, ghi chú: ${newNote}` : ""}.`
    });
};

const executeRemoveCartItem = async (customerId, itemName) => {
    const menuItem = await chatRepository.findMenuItemByName(itemName);
    if (!menuItem) {
        return JSON.stringify({ success: false, message: `Không tìm thấy món "${itemName}".` });
    }

    await cartRepository.deleteCartItem(customerId, menuItem.id);

    return JSON.stringify({
        success: true,
        message: `Đã xóa "${menuItem.name}" khỏi giỏ hàng.`
    });
};

const executeGetDeliveryInfo = async (customerId) => {
    const address = await chatRepository.getCustomerDefaultAddress(customerId);
    if (!address) {
        return JSON.stringify({
            message: "Bạn chưa có địa chỉ giao hàng mặc định. Vui lòng vào trang cá nhân → mục \"Địa chỉ\" để thêm địa chỉ."
        });
    }

    return JSON.stringify({
        address: address.address_line,
        ward: address.ward_name,
        shippingFee: Number(address.shipping_fee)
    });
};

const executePlaceOrder = async (customerId, voucherCode = null, notes = null) => {
    // 1. Kiểm tra giỏ hàng
    const { items, totalCart } = await cartRepository.getCartItems(customerId);
    if (!items || items.length === 0) {
        return JSON.stringify({ success: false, message: "Giỏ hàng đang trống. Hãy thêm món trước nhé!" });
    }

    // 2. Lấy thông tin khách hàng
    const customer = await chatRepository.getCustomerInfo(customerId);
    if (!customer || !customer.phone_number) {
        return JSON.stringify({ success: false, message: "Vui lòng cập nhật số điện thoại trong hồ sơ để đặt hàng." });
    }

    // 3. Lấy địa chỉ mặc định
    const address = await chatRepository.getCustomerDefaultAddress(customerId);
    if (!address) {
        return JSON.stringify({
            success: false,
            message: "Bạn chưa có địa chỉ giao hàng mặc định. Vào trang cá nhân → mục \"Địa chỉ\" để thêm nhé!"
        });
    }

    // 4. Tìm voucher nếu có
    let voucherId = null;
    let voucherWarning = null;
    if (voucherCode) {
        const voucher = await chatRepository.getVoucherByCode(String(voucherCode).trim());
        if (voucher && voucher.is_active) {
            voucherId = voucher.id;
        } else {
            voucherWarning = `Mã voucher "${voucherCode}" không hợp lệ hoặc đã hết hạn. Đơn hàng sẽ được đặt không áp dụng voucher.`;
        }
    }

    // 5. Tạo order (trạng thái 'cart')
    const orderItems = items.map((item) => ({
        menu_item_id: item.menu_item_id,
        price: Number(item.price),
        quantity: Number(item.quantity),
        note: item.note || null
    }));

    const createData = {
        deliveryFullName: customer.full_name,
        deliveryPhone: customer.phone_number,
        items: orderItems,
        discountAmount: 0,
        notes: notes || null
    };

    const { orderCode, totalAmount: cartTotal } = await orderRepository.createOrUpdateOrder(customerId, createData);

    // 6. Xác nhận order (chuyển từ 'cart' → 'pending' với COD)
    const confirmData = {
        delivery_full_name: customer.full_name,
        delivery_phone: customer.phone_number,
        delivery_address: address.address_line,
        delivery_ward_name: address.ward_name,
        subtotal: Number(totalCart),
        voucher_id: voucherId,
        notes: notes || null
    };

    const result = await orderRepository.confirmOrder(orderCode, confirmData, "cash");

    // 7. Xóa giỏ hàng
    await cartRepository.deleteAllCartItems(customerId);

    // 8. Tạo ETA giao hàng để client lưu vào localStorage qua socket/update response
    let estimatedMinutes = null;
    let estimatedTime = null;
    try {
        const now = new Date();
        const totalItems = items.reduce((sum, i) => sum + Number(i.quantity), 0);
        const numDistinct = items.length;
        const prediction = await getDeliveryPrediction({
            ward_name: address.ward_name,
            total_items: totalItems,
            num_distinct: numDistinct,
            order_hour: now.getHours(),
            day_of_week: (now.getDay() + 6) % 7,
            subtotal: Number(totalCart)
        });
        estimatedMinutes = prediction.estimated_minutes;
        estimatedTime = prediction.estimated_time;
    } catch { /* ML không sẵn sàng — bỏ qua */ }

    return JSON.stringify({
        success: true,
        orderCode,
        subtotal: Number(totalCart),
        promotionDiscount: result.promotionDiscount || 0,
        voucherDiscount: result.voucherDiscount || 0,
        discountAmount: result.discountAmount,
        shippingFee: Number(address.shipping_fee),
        totalAmount: result.totalAmount,
        deliveryAddress: `${address.address_line}, ${address.ward_name}`,
        paymentMethod: "Thanh toán khi nhận hàng (COD)",
        voucherCode: result.voucherCode || null,
        voucherWarning: voucherWarning || null,
        estimatedMinutes,
        estimatedTime
    });
};

const startConversation = async (customerId) => {
    const admin = await chatRepository.getAdminUser();
    if (!admin) {
        throw createHttpError(404, "Không tìm thấy admin để hỗ trợ chat.");
    }

    let conversation = await chatRepository.getConversationByCustomerId(customerId);
    if (!conversation) {
        conversation = await chatRepository.createConversation(customerId, admin.id);
    }

    return conversation;
};

const startConversationByAdmin = async (adminUserId, customerId) => {
    let conversation = await chatRepository.getConversationByCustomerId(customerId);
    if (!conversation) {
        conversation = await chatRepository.createConversation(customerId, adminUserId);
    }

    // Turn off bot so admin can chat directly
    if (conversation.is_bot_active) {
        conversation = await chatRepository.setBotActiveStatus(conversation.id, false);
    }

    return conversation;
};

const assertConversationAccess = (conversation, currentUser) => {
    if (!conversation) {
        throw createHttpError(404, "Hội thoại không tồn tại.");
    }

    if (currentUser.role === "customer" && Number(conversation.customer_id) !== Number(currentUser.id)) {
        throw createHttpError(403, "Bạn không có quyền truy cập hội thoại này.");
    }
};

const sendMessage = async ({ currentUser, conversationId, text }) => {
    const content = String(text || "").trim();
    if (!content) {
        throw createHttpError(400, "Nội dung tin nhắn không được để trống.");
    }

    const conversation = await chatRepository.getConversationById(conversationId);
    assertConversationAccess(conversation, currentUser);

    const isSenderAdmin = currentUser.role === "admin";
    const isRequestingHuman = content === "[REQUEST_HUMAN]";
    const actualText = isRequestingHuman ? "Mình muốn được nhân viên tư vấn trực tiếp." : content;

    const userMessage = await chatRepository.createMessage({
        conversationId,
        senderType: isSenderAdmin ? "admin" : "customer",
        senderCustomerId: isSenderAdmin ? null : currentUser.id,
        senderUserId: isSenderAdmin ? currentUser.id : null,
        text: actualText
    });

    if (!isSenderAdmin && isRequestingHuman) {
        await chatRepository.setBotActiveStatus(conversationId, false);

        const handoffMessage = await chatRepository.createMessage({
            conversationId,
            senderType: "bot",
            senderUserId: conversation.admin_user_id,
            text: "Hệ thống đã ghi nhận yêu cầu. Bạn vui lòng chờ một lát, nhân viên hỗ trợ sẽ phản hồi bạn ngay nhé!"
        });

        return {
            userMessage,
            aiMessage: handoffMessage,
            isBotActive: false
        };
    }

    if (isSenderAdmin || !conversation.is_bot_active) {
        return {
            userMessage,
            aiMessage: null,
            isBotActive: Boolean(conversation.is_bot_active)
        };
    }

    try {
        const history = await chatRepository.getRecentMessages(conversationId, HISTORY_LIMIT);
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...history.map((msg) => ({
                role: msg.sender_type === "customer" ? "user" : "assistant",
                content: msg.text
            }))
        ];

        let response = await callAI({
            model: AI_MODEL,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.5
        });

        let aiResponseMsg = response.choices[0]?.message || { content: "" };
        let cartUpdated = false;
        let orderPlacedData = null;
        let toolRounds = 0;
        const MAX_TOOL_ROUNDS = 3;

        while (aiResponseMsg.tool_calls?.length > 0 && toolRounds < MAX_TOOL_ROUNDS) {
            toolRounds++;
            messages.push(aiResponseMsg);

            for (const toolCall of aiResponseMsg.tool_calls) {
                let dbResult = JSON.stringify({ message: "Tool không được hỗ trợ." });
                const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};

                if (toolCall.function.name === "search_menu_items") {
                    dbResult = await executeSearchMenuItems(args.query);
                }

                if (toolCall.function.name === "get_menu_items_by_price") {
                    dbResult = await executeGetMenuItemsByPrice(args.sort, args.limit, args.menuType, args.category);
                }

                if (toolCall.function.name === "get_promotions") {
                    dbResult = await executeGetPromotions();
                }

                if (toolCall.function.name === "get_order_history") {
                    dbResult = await executeGetOrderHistory(conversation.customer_id, args.limit);
                }

                if (toolCall.function.name === "track_orders") {
                    dbResult = await executeTrackOrders(conversation.customer_id);
                }

                if (toolCall.function.name === "add_to_cart_item") {
                    dbResult = await executeAddToCart(conversation.customer_id, args.itemName, args.quantity, args.note);
                    try { if (JSON.parse(dbResult).success) cartUpdated = true; } catch { /* silent */ }
                }

                if (toolCall.function.name === "view_cart") {
                    dbResult = await executeViewCart(conversation.customer_id);
                }

                if (toolCall.function.name === "get_delivery_info") {
                    dbResult = await executeGetDeliveryInfo(conversation.customer_id);
                }

                if (toolCall.function.name === "place_order") {
                    dbResult = await executePlaceOrder(conversation.customer_id, args.voucherCode, args.notes);
                    try {
                        const parsed = JSON.parse(dbResult);
                        if (parsed.success) {
                            cartUpdated = true;
                            orderPlacedData = {
                                orderCode: parsed.orderCode,
                                customerId: conversation.customer_id,
                                estimatedMinutes: parsed.estimatedMinutes,
                                estimatedTime: parsed.estimatedTime
                            };
                        }
                    } catch { /* silent */ }
                }

                if (toolCall.function.name === "filter_menu_items") {
                    dbResult = await executeFilterMenuItems(args);
                }

                if (toolCall.function.name === "update_cart_item") {
                    dbResult = await executeUpdateCartItem(conversation.customer_id, args.itemName, args.quantity, args.note);
                    try { if (JSON.parse(dbResult).success) cartUpdated = true; } catch { /* silent */ }
                }

                if (toolCall.function.name === "remove_cart_item") {
                    dbResult = await executeRemoveCartItem(conversation.customer_id, args.itemName);
                    try { if (JSON.parse(dbResult).success) cartUpdated = true; } catch { /* silent */ }
                }

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: dbResult
                });
            }

            response = await callAI({
                model: AI_MODEL,
                messages,
                tools,
                tool_choice: "auto",
                temperature: 0.5
            });

            aiResponseMsg = response.choices[0]?.message || { content: "" };
        }

        const aiText = String(aiResponseMsg.content || "").trim() || FALLBACK_MSG;
        const aiMessage = await chatRepository.createMessage({
            conversationId,
            senderType: "bot",
            senderUserId: conversation.admin_user_id,
            text: aiText
        });

        return {
            userMessage,
            aiMessage,
            isBotActive: true,
            cartUpdated,
            orderPlaced: orderPlacedData
        };
    } catch (error) {
        console.error("AI chat error:", error.message || error);

        const aiMessage = await chatRepository.createMessage({
            conversationId,
            senderType: "bot",
            senderUserId: conversation.admin_user_id,
            text: FALLBACK_MSG
        });

        return {
            userMessage,
            aiMessage,
            isBotActive: true
        };
    }
};

const getMessages = async ({ currentUser, conversationId }) => {
    const conversation = await chatRepository.getConversationById(conversationId);
    assertConversationAccess(conversation, currentUser);

    return chatRepository.getMessagesByConversationId(conversationId);
};

const getConversations = async (currentUser) => {
    if (currentUser.role === "admin") {
        return chatRepository.getConversationsForAdmin();
    }

    if (currentUser.role === "customer") {
        return chatRepository.getConversationsForCustomer(currentUser.id);
    }

    throw createHttpError(403, "Vai trò không được phép truy cập danh sách chat.");
};

const toggleBot = async ({ currentUser, conversationId, isBotActive }) => {
    if (currentUser.role !== "admin") {
        throw createHttpError(403, "Chỉ admin mới được bật/tắt bot.");
    }

    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) {
        throw createHttpError(404, "Hội thoại không tồn tại.");
    }

    return chatRepository.setBotActiveStatus(conversationId, Boolean(isBotActive));
};

const markMessagesAsRead = async ({ currentUser, conversationId }) => {
    const conversation = await chatRepository.getConversationById(conversationId);
    assertConversationAccess(conversation, currentUser);

    const readRole = currentUser.role === "admin" ? "admin" : "customer";
    await chatRepository.markMessagesAsRead(conversationId, readRole);
};

const getUnreadCount = async (currentUser) => {
    return chatRepository.getUnreadCount({ userId: currentUser.id, role: currentUser.role });
};



const getChatDashboardStats = async (filters) => {
    return chatRepository.getChatDashboardStats(filters);
};

const getConversationSummary = async ({ conversationId }) => {
    const messagesData = await chatRepository.getConversationSummaryData(conversationId);
    if (messagesData.length === 0) {
        return { summary: "Chưa có tin nhắn trong hội thoại này." };
    }

    const client = getOpenAIClient();
    if (!client) {
        const lastCustomerMsg = messagesData.filter((m) => m.sender_type === "customer").pop();
        return { summary: lastCustomerMsg ? `Khách hỏi: "${lastCustomerMsg.text}"` : "Không có nội dung từ khách." };
    }

    const transcript = messagesData.map((m) => {
        const role = m.sender_type === "customer" ? "Khách" : m.sender_type === "bot" ? "Bot" : "Admin";
        return `${role}: ${m.text}`;
    }).join("\n");

    try {
        const response = await callAI({
            model: AI_MODEL,
            messages: [
                {
                    role: "system", content: `Tóm tắt cuộc hội thoại dưới đây trong 1-2 câu ngắn gọn bằng tiếng Việt.
                     Nêu vấn đề chính khách hàng cần hỗ trợ.` },
                { role: "user", content: transcript }
            ],
            temperature: 0.3
        });

        return { summary: response.choices[0]?.message?.content?.trim() || "Không thể tóm tắt." };
    } catch {
        const lastCustomerMsg = messagesData.filter((m) => m.sender_type === "customer").pop();
        return { summary: lastCustomerMsg ? `Khách hỏi: "${lastCustomerMsg.text}"` : "Không thể tóm tắt." };
    }
};

const deleteConversation = async (conversationId) => {
    const conversation = await chatRepository.getConversationById(conversationId);
    if (!conversation) {
        throw createHttpError(404, "Không tìm thấy hội thoại.");
    }
    await chatRepository.deleteConversation(conversationId);
};

module.exports = {
    startConversation,
    startConversationByAdmin,
    sendMessage,
    getMessages,
    getConversations,
    toggleBot,
    markMessagesAsRead,
    getUnreadCount,
    getChatDashboardStats,
    getConversationSummary,
    deleteConversation
};
