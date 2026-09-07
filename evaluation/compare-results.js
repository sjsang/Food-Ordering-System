/**
 * So sánh kết quả giữa nhiều lần đánh giá
 * Sử dụng: node evaluation/compare-results.js
 * 
 * Tự động tìm tất cả file evaluation-*.json trong thư mục results/
 * và so sánh các chỉ số chính.
 */

const fs = require("fs");
const path = require("path");

const RESULTS_DIR = path.join(__dirname, "results");

const main = () => {
    if (!fs.existsSync(RESULTS_DIR)) {
        console.log("❌ Chưa có kết quả đánh giá. Chạy evaluator.js trước.");
        return;
    }

    const files = fs.readdirSync(RESULTS_DIR)
        .filter((f) => f.startsWith("evaluation-") && f.endsWith(".json"))
        .sort();

    if (files.length === 0) {
        console.log("❌ Không tìm thấy file kết quả nào.");
        return;
    }

    console.log("╔═══════════════════════════════════════════════════════════════╗");
    console.log("║          SO SÁNH KẾT QUẢ ĐÁNH GIÁ QUA CÁC LẦN             ║");
    console.log("╚═══════════════════════════════════════════════════════════════╝\n");

    const allStats = files.map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf-8"));
        return { file: f, stats: data.stats };
    });

    // Header
    const colWidth = 22;
    const metricWidth = 28;
    let header = "│ " + "Chỉ số".padEnd(metricWidth) + "│";
    for (const s of allStats) {
        const label = s.file.replace("evaluation-", "").replace(".json", "").slice(0, colWidth - 2);
        header += " " + label.padEnd(colWidth - 1) + "│";
    }

    const separator = "├" + "─".repeat(metricWidth + 1) + "┼" + allStats.map(() => "─".repeat(colWidth) + "┼").join("").slice(0, -1) + "┤";

    console.log("┌" + "─".repeat(metricWidth + 1) + "┬" + allStats.map(() => "─".repeat(colWidth) + "┬").join("").slice(0, -1) + "┐");
    console.log(header);
    console.log(separator);

    // Metrics rows
    const metrics = [
        { label: "Success Rate", get: (s) => `${(s.overview.successRate * 100).toFixed(1)}%` },
        { label: "Timeout Rate", get: (s) => `${(s.overview.timeoutRate * 100).toFixed(1)}%` },
        { label: "", get: () => "" },
        { label: "Avg Latency", get: (s) => `${s.performance.avgLatency} ms` },
        { label: "P50 Latency", get: (s) => `${s.performance.p50Latency} ms` },
        { label: "P90 Latency", get: (s) => `${s.performance.p90Latency} ms` },
        { label: "P95 Latency", get: (s) => `${s.performance.p95Latency} ms` },
        { label: "", get: () => "" },
        { label: "Tool Call Accuracy", get: (s) => `${s.accuracy.toolCallAccuracy}%` },
        { label: "Tool Precision", get: (s) => `${s.accuracy.toolCallPrecision}%` },
        { label: "Tool Recall", get: (s) => `${s.accuracy.toolCallRecall}%` },
        { label: "Parameter Accuracy", get: (s) => `${s.accuracy.parameterAccuracy}%` },
        { label: "", get: () => "" },
        { label: "Quality - Relevance", get: (s) => `${s.quality.relevance}/5` },
        { label: "Quality - Accuracy", get: (s) => `${s.quality.accuracy}/5` },
        { label: "Quality - Tone", get: (s) => `${s.quality.tone}/5` },
        { label: "Quality - Conciseness", get: (s) => `${s.quality.conciseness}/5` },
        { label: "Quality - Helpfulness", get: (s) => `${s.quality.helpfulness}/5` },
        { label: "Overall Quality", get: (s) => `${s.quality.overallQuality}/5` }
    ];

    for (const m of metrics) {
        if (m.label === "") {
            console.log(separator);
            continue;
        }
        let row = "│ " + m.label.padEnd(metricWidth) + "│";
        for (const s of allStats) {
            const val = m.get(s.stats);
            row += " " + val.padEnd(colWidth - 1) + "│";
        }
        console.log(row);
    }

    console.log("└" + "─".repeat(metricWidth + 1) + "┴" + allStats.map(() => "─".repeat(colWidth) + "┴").join("").slice(0, -1) + "┘");

    // Trend analysis
    if (allStats.length >= 2) {
        const first = allStats[0].stats;
        const last = allStats[allStats.length - 1].stats;

        console.log("\n📈 XU HƯỚNG (Lần đầu → Lần cuối):");

        const trends = [
            { label: "Tool Accuracy", first: first.accuracy.toolCallAccuracy, last: last.accuracy.toolCallAccuracy, unit: "%" },
            { label: "Quality", first: first.quality.overallQuality, last: last.quality.overallQuality, unit: "/5" },
            { label: "Avg Latency", first: first.performance.avgLatency, last: last.performance.avgLatency, unit: "ms", lowerBetter: true }
        ];

        for (const t of trends) {
            const diff = t.last - t.first;
            const improved = t.lowerBetter ? diff < 0 : diff > 0;
            const icon = diff === 0 ? "➡️" : improved ? "📈" : "📉";
            const sign = diff > 0 ? "+" : "";
            console.log(`   ${icon} ${t.label}: ${t.first}${t.unit} → ${t.last}${t.unit} (${sign}${diff.toFixed(2)}${t.unit})`);
        }
    }
};

main();
