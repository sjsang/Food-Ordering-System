const http = require("http");

const ACTIVE_PREDICTION_FALLBACK_MODEL = "fallback-heuristic";

const normalizeWardName = (value) =>
    String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

const getWardAdjustmentMinutes = (wardName) => {
    const normalized = normalizeWardName(wardName);

    if (!normalized) return 4;
    if (/(thoi lai|thoi an dong|long tuyen|long hoa|phuoc tho|truong lac)/.test(normalized)) return 16;
    if (/(binh thuy|tra an|tra noc|an thoi|ba lang)/.test(normalized)) return 12;
    if (/(cai khe|an cu|an hoi|xuan khanh|hung loi|hung phu)/.test(normalized)) return 8;

    return 10;
};

const buildFallbackPrediction = ({ ward_name, total_items, num_distinct, order_hour, day_of_week, subtotal }) => {
    const items = Math.max(1, Number(total_items) || 1);
    const distinctItems = Math.max(1, Number(num_distinct) || 1);
    const hour = Number.isFinite(Number(order_hour)) ? Number(order_hour) : new Date().getHours();
    const day = Number.isFinite(Number(day_of_week)) ? Number(day_of_week) : ((new Date().getDay() + 6) % 7);
    const amount = Math.max(0, Number(subtotal) || 0);

    const isPeakHour = (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 20);
    const isWeekend = day >= 5;

    let estimatedMinutes = 22;
    estimatedMinutes += getWardAdjustmentMinutes(ward_name);
    estimatedMinutes += Math.min(items * 2, 14);
    estimatedMinutes += Math.min(Math.max(distinctItems - 1, 0), 5);
    estimatedMinutes += amount >= 300000 ? 6 : amount >= 180000 ? 4 : amount >= 90000 ? 2 : 0;
    estimatedMinutes += isPeakHour ? 8 : 0;
    estimatedMinutes += isWeekend ? 4 : 0;
    estimatedMinutes = Math.min(Math.max(estimatedMinutes, 20), 75);

    return {
        estimated_minutes: estimatedMinutes,
        estimated_time: new Date(Date.now() + estimatedMinutes * 60000).toISOString(),
        confidence: "low",
        model: ACTIVE_PREDICTION_FALLBACK_MODEL
    };
};

const requestMlPrediction = async ({ ward_name, total_items, num_distinct, order_hour, day_of_week, subtotal }) => {
    const payload = JSON.stringify({
        ward_name,
        total_items: Math.max(1, Number(total_items) || 1),
        num_distinct: Math.max(1, Number(num_distinct) || 1),
        order_hour: Number.isFinite(Number(order_hour)) ? Number(order_hour) : new Date().getHours(),
        day_of_week: Number.isFinite(Number(day_of_week)) ? Number(day_of_week) : ((new Date().getDay() + 6) % 7),
        subtotal: Math.max(0, Number(subtotal) || 0)
    });

    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                hostname: "127.0.0.1",
                port: 5050,
                path: "/predict",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                },
                timeout: 5000
            },
            (response) => {
                let data = "";

                response.on("data", (chunk) => {
                    data += chunk;
                });

                response.on("end", () => {
                    try {
                        const parsed = JSON.parse(data || "{}");
                        resolve(parsed);
                    } catch {
                        reject(new Error("ML_INVALID_RESPONSE"));
                    }
                });
            }
        );

        request.on("error", () => reject(new Error("ML_SERVICE_UNAVAILABLE")));
        request.on("timeout", () => {
            request.destroy();
            reject(new Error("ML_TIMEOUT"));
        });

        request.write(payload);
        request.end();
    });
};

const getDeliveryPrediction = async (input) => {
    const fallback = buildFallbackPrediction(input);

    try {
        const result = await requestMlPrediction(input);
        const estimatedMinutes = Math.max(10, Number(result?.estimated_minutes) || fallback.estimated_minutes);

        return {
            estimated_minutes: estimatedMinutes,
            estimated_time: new Date(Date.now() + estimatedMinutes * 60000).toISOString(),
            confidence: result?.confidence || fallback.confidence,
            model: result?.model || fallback.model
        };
    } catch {
        return fallback;
    }
};

module.exports = {
    buildFallbackPrediction,
    getDeliveryPrediction
};