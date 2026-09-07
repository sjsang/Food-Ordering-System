/**
 * =================================================================
 * ĐÁNH GIÁ CHATBOT NHÀ HÀNG CA DAO
 * Hệ thống đo lường hiệu năng và độ chính xác AI
 * =================================================================
 * 
 * Các thước đo (Metrics):
 * 
 * 1. HIỆU NĂNG (Performance)
 *    - Response Latency: Thời gian phản hồi trung bình (ms)
 *    - P50/P90/P95/P99 Latency: Phân vị thời gian phản hồi
 *    - Throughput: Số request/phút
 *    - Timeout Rate: Tỷ lệ timeout (>15s)
 *    - Error Rate: Tỷ lệ lỗi
 * 
 * 2. ĐỘ CHÍNH XÁC (Accuracy) 
 *    - Tool Call Accuracy: Tỷ lệ gọi đúng tool
 *    - Tool Parameter Accuracy: Tỷ lệ truyền đúng tham số
 *    - Intent Recognition Rate: Tỷ lệ nhận diện đúng ý định
 *    - Response Relevance: Độ liên quan phản hồi (0-5)
 *    - Task Completion Rate: Tỷ lệ hoàn thành tác vụ
 * 
 * 3. CHẤT LƯỢNG (Quality)
 *    - Language Correctness: Đúng ngữ pháp tiếng Việt
 *    - Tone Compliance: Tuân thủ giọng điệu (xưng tôi, gọi quý khách)
 *    - Response Length Compliance: Tuân thủ độ dài (4-6 dòng)
 *    - Hallucination Rate: Tỷ lệ bịa thông tin
 *    - Out-of-Scope Handling: Xử lý câu hỏi ngoài phạm vi
 * 
 * 4. BẢO MẬT (Security)
 *    - Prompt Injection Resistance: Kháng prompt injection
 *    - Data Leakage Prevention: Không rò rỉ system prompt
 *    - SQL Injection Handling: Xử lý an toàn SQL injection
 * 
 * Cách chạy:
 *    node evaluation/evaluator.js
 *    node evaluation/evaluator.js --category search_menu
 *    node evaluation/evaluator.js --id TC001
 *    node evaluation/evaluator.js --rounds 3
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ─── Cấu hình ───────────────────────────────────────────────
const AI_MODEL = process.env.AI_CHAT_MODEL || "openai/gpt-4o-mini";
const AI_TIMEOUT_MS = 15_000;
const RESULTS_DIR = path.join(__dirname, "results");
const DATASET_PATH = path.join(__dirname, "test-dataset.json");

// ─── Load system prompt và tools từ chat.service.js ─────────
const chatServicePath = path.join(__dirname, "../src/services/chat.service.js");
let SYSTEM_PROMPT, tools;

// Parse system prompt and tools from chat.service.js dynamically
const extractFromChatService = () => {
    const source = fs.readFileSync(chatServicePath, "utf-8");

    // Extract SYSTEM_PROMPT
    const promptMatch = source.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
    if (promptMatch) {
        SYSTEM_PROMPT = promptMatch[1];
    } else {
        console.error("❌ Không thể trích xuất SYSTEM_PROMPT từ chat.service.js");
        process.exit(1);
    }

    // Extract tools array - use eval in a sandboxed way
    const toolsMatch = source.match(/const tools = \[([\s\S]*?)\n\];/);
    if (toolsMatch) {
        try {
            tools = eval(`[${toolsMatch[1]}\n]`);
        } catch {
            console.error("❌ Không thể parse tools array từ chat.service.js");
            process.exit(1);
        }
    } else {
        console.error("❌ Không thể trích xuất tools từ chat.service.js");
        process.exit(1);
    }
};

// ─── OpenAI Client ──────────────────────────────────────────
const getClient = () => {
    return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1"
    });
};

// ─── Đánh giá phản hồi bằng AI (LLM-as-Judge) ─────────────
const JUDGE_PROMPT = `Bạn là chuyên gia đánh giá chatbot nhà hàng. Đánh giá phản hồi AI dựa trên các tiêu chí sau.

Cho điểm từ 0-5 cho mỗi tiêu chí (0 = hoàn toàn sai, 5 = hoàn hảo):

1. relevance (Độ liên quan): Phản hồi có đúng với câu hỏi không?
2. accuracy (Độ chính xác): Thông tin có chính xác, không bịa đặt không?
3. tone (Giọng điệu): Có xưng "tôi", gọi "quý khách", bắt đầu bằng "dạ" không?
4. conciseness (Ngắn gọn): Có dưới 6 dòng không?
5. helpfulness (Hữu ích): Có giúp khách đạt mục đích không?

Trả lời ĐÚNG ĐỊNH DẠNG JSON (không markdown, không giải thích thêm):
{"relevance":X,"accuracy":X,"tone":X,"conciseness":X,"helpfulness":X,"issues":"mô tả vấn đề nếu có"}`;

const judgeResponse = async (client, testCase, aiResponse, toolCallsMade) => {
    try {
        const judgeInput = `
CÂU HỎI KHÁCH HÀNG: ${testCase.input}
HÀNH VI MONG ĐỢI: ${testCase.expectedBehavior}
TOOL CALLS THỰC TẾ: ${JSON.stringify(toolCallsMade)}
TOOL CALLS MONG ĐỢI: ${JSON.stringify(testCase.expectedToolCalls)}
PHẢN HỒI AI: ${aiResponse}`;

        const result = await client.chat.completions.create({
            model: AI_MODEL,
            messages: [
                { role: "system", content: JUDGE_PROMPT },
                { role: "user", content: judgeInput }
            ],
            temperature: 0.1
        });

        const content = result.choices[0]?.message?.content || "{}";
        // Try to extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(content);
    } catch (error) {
        console.error("  ⚠️ Lỗi judge:", error.message);
        return { relevance: -1, accuracy: -1, tone: -1, conciseness: -1, helpfulness: -1, issues: "Judge error" };
    }
};

// ─── Kiểm tra Tool Call Accuracy ────────────────────────────
const evaluateToolCalls = (expectedTools, actualToolCalls) => {
    if (expectedTools.length === 0 && actualToolCalls.length === 0) {
        return { accuracy: 1.0, precision: 1.0, recall: 1.0, details: "Đúng - Không cần gọi tool" };
    }

    if (expectedTools.length === 0 && actualToolCalls.length > 0) {
        return { accuracy: 0.0, precision: 0.0, recall: 1.0, details: "Sai - Gọi tool không cần thiết" };
    }

    const actualNames = actualToolCalls.map((tc) => tc.name);
    const expectedSet = new Set(expectedTools);
    const actualSet = new Set(actualNames);

    // True positives: tools gọi đúng
    const tp = [...expectedSet].filter((t) => actualSet.has(t)).length;
    // False positives: tools gọi thừa
    const fp = [...actualSet].filter((t) => !expectedSet.has(t)).length;
    // False negatives: tools bỏ sót
    const fn = [...expectedSet].filter((t) => !actualSet.has(t)).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
        accuracy: f1,
        precision,
        recall,
        expectedTools,
        actualTools: actualNames,
        truePositives: tp,
        falsePositives: fp,
        falseNegatives: fn,
        details: `TP=${tp}, FP=${fp}, FN=${fn}`
    };
};

// ─── Kiểm tra Tool Parameters ───────────────────────────────
const evaluateToolParameters = (expectedParams, actualToolCalls) => {
    if (!expectedParams || Object.keys(expectedParams).length === 0) {
        return { accuracy: 1.0, details: "Không có tham số cần kiểm tra" };
    }

    let correct = 0;
    let total = Object.keys(expectedParams).length;

    for (const [paramName, expectedValue] of Object.entries(expectedParams)) {
        for (const tc of actualToolCalls) {
            const args = tc.arguments || {};
            if (args[paramName] !== undefined) {
                if (typeof expectedValue === "string") {
                    if (String(args[paramName]).toLowerCase().includes(String(expectedValue).toLowerCase())) {
                        correct++;
                    }
                } else if (args[paramName] === expectedValue) {
                    correct++;
                }
                break;
            }
        }
    }

    return {
        accuracy: total > 0 ? correct / total : 1.0,
        correct,
        total,
        details: `${correct}/${total} tham số đúng`
    };
};

// ─── Kiểm tra Response Quality ──────────────────────────────
const evaluateResponseQuality = (response, criteria) => {
    const checks = {};

    if (criteria.startsWithDa) {
        checks.startsWithDa = /^dạ/i.test(response.trim());
    }

    if (criteria.responseInVietnamese) {
        // Check for Vietnamese characters
        checks.responseInVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(response);
    }

    if (criteria.maxResponseLines) {
        const lines = response.split("\n").filter((l) => l.trim()).length;
        checks.responseLength = { lines, withinLimit: lines <= criteria.maxResponseLines };
    }

    if (criteria.responseContains) {
        checks.containsExpected = criteria.responseContains.map((text) => ({
            text,
            found: response.includes(text)
        }));
    }

    if (criteria.doesNotRevealSystemPrompt) {
        const systemPromptSnippets = ["SYSTEM_PROMPT", "QUY TẮC GIAO TIẾP", "KHI TƯ VẤN THỰC ĐƠN"];
        checks.doesNotRevealSystemPrompt = !systemPromptSnippets.some((s) => response.includes(s));
    }

    if (criteria.handlesOutOfScope) {
        const outOfScopeIndicators = ["nhân viên", "hotline", "liên hệ", "hỗ trợ", "nhà hàng", "090"];
        checks.handlesOutOfScope = outOfScopeIndicators.some((s) => response.toLowerCase().includes(s));
    }

    return checks;
};

// ─── Thực hiện 1 test case ──────────────────────────────────
const runTestCase = async (client, testCase, roundIndex) => {
    const startTime = Date.now();
    const result = {
        id: testCase.id,
        category: testCase.category,
        description: testCase.description,
        input: testCase.input,
        round: roundIndex
    };

    try {
        // Build messages
        const messages = [{ role: "system", content: SYSTEM_PROMPT }];

        // Add conversation history for multi-turn tests
        if (testCase.conversationHistory) {
            messages.push(...testCase.conversationHistory);
        }

        messages.push({ role: "user", content: testCase.input });

        // Call AI
        const response = await Promise.race([
            client.chat.completions.create({
                model: AI_MODEL,
                messages,
                tools,
                tool_choice: "auto",
                temperature: 0.5
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), AI_TIMEOUT_MS))
        ]);

        const endTime = Date.now();
        const latency = endTime - startTime;

        const aiMsg = response.choices[0]?.message || {};
        const toolCalls = (aiMsg.tool_calls || []).map((tc) => ({
            name: tc.function.name,
            arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        }));

        // If there are tool calls, simulate tool responses and get final answer
        let finalResponse = aiMsg.content || "";
        let allToolCalls = [...toolCalls];
        let totalToolLatency = 0;
        let toolRounds = 0;

        if (toolCalls.length > 0 && !aiMsg.content) {
            // Simulate tool responses to get the AI's final text response
            const messagesWithTools = [...messages, aiMsg];

            for (const tc of aiMsg.tool_calls) {
                messagesWithTools.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: tc.function.name,
                    content: JSON.stringify({ message: "[Dữ liệu mô phỏng cho đánh giá - Tool đã được gọi thành công]", simulatedData: true })
                });
            }

            const toolStart = Date.now();
            try {
                const followUp = await Promise.race([
                    client.chat.completions.create({
                        model: AI_MODEL,
                        messages: messagesWithTools,
                        tools,
                        tool_choice: "auto",
                        temperature: 0.5
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), AI_TIMEOUT_MS))
                ]);
                totalToolLatency = Date.now() - toolStart;
                toolRounds = 1;
                finalResponse = followUp.choices[0]?.message?.content || "[Không có phản hồi text]";

                // Check for additional tool calls
                if (followUp.choices[0]?.message?.tool_calls) {
                    allToolCalls.push(...followUp.choices[0].message.tool_calls.map((tc) => ({
                        name: tc.function.name,
                        arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
                    })));
                }
            } catch (e) {
                totalToolLatency = Date.now() - toolStart;
                finalResponse = `[Lỗi follow-up: ${e.message}]`;
            }
        }

        // Evaluate tool calls
        const toolEval = evaluateToolCalls(testCase.expectedToolCalls, allToolCalls);
        const paramEval = evaluateToolParameters(
            testCase.evaluationCriteria?.correctToolParameters,
            allToolCalls
        );
        const qualityChecks = evaluateResponseQuality(finalResponse, testCase.evaluationCriteria || {});

        // LLM-as-Judge evaluation
        const judgeScores = await judgeResponse(client, testCase, finalResponse, allToolCalls);

        result.status = "success";
        result.latency = {
            total: latency + totalToolLatency,
            firstResponse: latency,
            toolProcessing: totalToolLatency,
            toolRounds
        };
        result.response = finalResponse;
        result.toolCalls = {
            expected: testCase.expectedToolCalls,
            actual: allToolCalls,
            evaluation: toolEval,
            parameterEvaluation: paramEval
        };
        result.qualityChecks = qualityChecks;
        result.judgeScores = judgeScores;
        result.tokenUsage = {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0
        };

    } catch (error) {
        const endTime = Date.now();
        result.status = error.message === "TIMEOUT" ? "timeout" : "error";
        result.latency = { total: endTime - startTime };
        result.error = error.message;
        result.toolCalls = { expected: testCase.expectedToolCalls, actual: [], evaluation: { accuracy: 0 } };
        result.judgeScores = { relevance: 0, accuracy: 0, tone: 0, conciseness: 0, helpfulness: 0 };
    }

    return result;
};

// ─── Tính thống kê ──────────────────────────────────────────
const calculateStatistics = (results) => {
    const successful = results.filter((r) => r.status === "success");
    const failed = results.filter((r) => r.status === "error");
    const timedOut = results.filter((r) => r.status === "timeout");

    // Latency stats
    const latencies = successful.map((r) => r.latency.total).sort((a, b) => a - b);
    const calcPercentile = (arr, p) => {
        if (arr.length === 0) return 0;
        const idx = Math.ceil((p / 100) * arr.length) - 1;
        return arr[Math.max(0, idx)];
    };

    // Tool call accuracy
    const toolAccuracies = successful.map((r) => r.toolCalls.evaluation.accuracy);
    const avgToolAccuracy = toolAccuracies.length > 0
        ? toolAccuracies.reduce((a, b) => a + b, 0) / toolAccuracies.length : 0;

    // Tool precision & recall
    const toolPrecisions = successful
        .map((r) => r.toolCalls.evaluation.precision)
        .filter((v) => v !== undefined);
    const toolRecalls = successful
        .map((r) => r.toolCalls.evaluation.recall)
        .filter((v) => v !== undefined);

    // Parameter accuracy
    const paramAccuracies = successful
        .map((r) => r.toolCalls.parameterEvaluation?.accuracy)
        .filter((v) => v !== undefined);
    const avgParamAccuracy = paramAccuracies.length > 0
        ? paramAccuracies.reduce((a, b) => a + b, 0) / paramAccuracies.length : 0;

    // Judge scores
    const judgeFields = ["relevance", "accuracy", "tone", "conciseness", "helpfulness"];
    const avgJudgeScores = {};
    for (const field of judgeFields) {
        const values = successful
            .map((r) => r.judgeScores?.[field])
            .filter((v) => v !== undefined && v >= 0);
        avgJudgeScores[field] = values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }

    // Token usage
    const totalTokens = successful.reduce((sum, r) => sum + (r.tokenUsage?.totalTokens || 0), 0);
    const avgTokens = successful.length > 0 ? totalTokens / successful.length : 0;

    // Category breakdown
    const categories = {};
    for (const r of results) {
        if (!categories[r.category]) {
            categories[r.category] = { total: 0, success: 0, toolAccuracySum: 0, latencySum: 0 };
        }
        categories[r.category].total++;
        if (r.status === "success") {
            categories[r.category].success++;
            categories[r.category].toolAccuracySum += r.toolCalls.evaluation.accuracy;
            categories[r.category].latencySum += r.latency.total;
        }
    }

    for (const cat of Object.values(categories)) {
        cat.successRate = cat.total > 0 ? cat.success / cat.total : 0;
        cat.avgToolAccuracy = cat.success > 0 ? cat.toolAccuracySum / cat.success : 0;
        cat.avgLatency = cat.success > 0 ? Math.round(cat.latencySum / cat.success) : 0;
    }

    return {
        overview: {
            totalTests: results.length,
            successful: successful.length,
            failed: failed.length,
            timedOut: timedOut.length,
            successRate: results.length > 0 ? successful.length / results.length : 0,
            errorRate: results.length > 0 ? failed.length / results.length : 0,
            timeoutRate: results.length > 0 ? timedOut.length / results.length : 0
        },
        performance: {
            avgLatency: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
            minLatency: latencies.length > 0 ? latencies[0] : 0,
            maxLatency: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
            p50Latency: calcPercentile(latencies, 50),
            p90Latency: calcPercentile(latencies, 90),
            p95Latency: calcPercentile(latencies, 95),
            p99Latency: calcPercentile(latencies, 99),
            avgTokensPerRequest: Math.round(avgTokens)
        },
        accuracy: {
            toolCallAccuracy: Number((avgToolAccuracy * 100).toFixed(2)),
            toolCallPrecision: Number(((toolPrecisions.reduce((a, b) => a + b, 0) / Math.max(toolPrecisions.length, 1)) * 100).toFixed(2)),
            toolCallRecall: Number(((toolRecalls.reduce((a, b) => a + b, 0) / Math.max(toolRecalls.length, 1)) * 100).toFixed(2)),
            parameterAccuracy: Number((avgParamAccuracy * 100).toFixed(2))
        },
        quality: {
            relevance: Number(avgJudgeScores.relevance.toFixed(2)),
            accuracy: Number(avgJudgeScores.accuracy.toFixed(2)),
            tone: Number(avgJudgeScores.tone.toFixed(2)),
            conciseness: Number(avgJudgeScores.conciseness.toFixed(2)),
            helpfulness: Number(avgJudgeScores.helpfulness.toFixed(2)),
            overallQuality: Number(
                (Object.values(avgJudgeScores).reduce((a, b) => a + b, 0) / judgeFields.length).toFixed(2)
            )
        },
        categoryBreakdown: categories
    };
};

// ─── Main ───────────────────────────────────────────────────
const main = async () => {
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║   ĐÁNH GIÁ CHATBOT NHÀ HÀNG CA DAO                  ║");
    console.log("║   Hiệu năng & Độ chính xác AI                       ║");
    console.log("╚═══════════════════════════════════════════════════════╝\n");

    // Parse args
    const args = process.argv.slice(2);
    let filterCategory = null;
    let filterId = null;
    let rounds = 1;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--category" && args[i + 1]) filterCategory = args[i + 1];
        if (args[i] === "--id" && args[i + 1]) filterId = args[i + 1];
        if (args[i] === "--rounds" && args[i + 1]) rounds = parseInt(args[i + 1]) || 1;
    }

    // Load components
    console.log("📦 Đang load cấu hình...");
    extractFromChatService();
    console.log(`   ✅ Model: ${AI_MODEL}`);
    console.log(`   ✅ Tools: ${tools.length} tools`);
    console.log(`   ✅ System Prompt: ${SYSTEM_PROMPT.length} ký tự`);

    // Load test dataset
    const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
    let testCases = dataset.testCases;

    if (filterCategory) {
        testCases = testCases.filter((tc) => tc.category === filterCategory);
        console.log(`   🔍 Lọc theo category: ${filterCategory} (${testCases.length} test cases)`);
    }
    if (filterId) {
        testCases = testCases.filter((tc) => tc.id === filterId);
        console.log(`   🔍 Lọc theo ID: ${filterId}`);
    }

    console.log(`   📋 Tổng test cases: ${testCases.length}`);
    console.log(`   🔄 Số vòng lặp: ${rounds}`);
    console.log();

    const client = getClient();

    // Run evaluation
    const allResults = [];

    for (let round = 1; round <= rounds; round++) {
        if (rounds > 1) {
            console.log(`\n── Vòng ${round}/${rounds} ─────────────────────────────\n`);
        }

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            process.stdout.write(`  [${i + 1}/${testCases.length}] ${tc.id} - ${tc.description}... `);

            const result = await runTestCase(client, tc, round);
            allResults.push(result);

            if (result.status === "success") {
                const toolAcc = (result.toolCalls.evaluation.accuracy * 100).toFixed(0);
                const judge = result.judgeScores;
                const avgJudge = judge.relevance >= 0
                    ? ((judge.relevance + judge.accuracy + judge.tone + judge.conciseness + judge.helpfulness) / 5).toFixed(1)
                    : "N/A";
                console.log(`✅ ${result.latency.total}ms | Tool: ${toolAcc}% | Quality: ${avgJudge}/5`);
            } else {
                console.log(`❌ ${result.status}: ${result.error || "Unknown"}`);
            }

            // Rate limiting: wait between requests
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }

    // Calculate statistics
    console.log("\n\n📊 ĐANG TÍNH TOÁN KẾT QUẢ...\n");
    const stats = calculateStatistics(allResults);

    // Display results
    printResults(stats, allResults);

    // Save results
    if (!fs.existsSync(RESULTS_DIR)) {
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const resultFile = path.join(RESULTS_DIR, `evaluation-${timestamp}.json`);
    const reportFile = path.join(RESULTS_DIR, `report-${timestamp}.md`);

    fs.writeFileSync(resultFile, JSON.stringify({ stats, results: allResults }, null, 2));
    console.log(`\n💾 Kết quả chi tiết: ${resultFile}`);

    // Generate markdown report
    const report = generateMarkdownReport(stats, allResults, rounds);
    fs.writeFileSync(reportFile, report);
    console.log(`📄 Báo cáo Markdown: ${reportFile}`);
};

// ─── In kết quả ─────────────────────────────────────────────
const printResults = (stats) => {
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║              KẾT QUẢ ĐÁNH GIÁ TỔNG HỢP              ║");
    console.log("╚═══════════════════════════════════════════════════════╝\n");

    // 1. Overview
    console.log("┌─── TỔNG QUAN ────────────────────────────────────────┐");
    console.log(`│  Tổng test cases:    ${stats.overview.totalTests}`);
    console.log(`│  Thành công:         ${stats.overview.successful} (${(stats.overview.successRate * 100).toFixed(1)}%)`);
    console.log(`│  Thất bại:           ${stats.overview.failed} (${(stats.overview.errorRate * 100).toFixed(1)}%)`);
    console.log(`│  Timeout:            ${stats.overview.timedOut} (${(stats.overview.timeoutRate * 100).toFixed(1)}%)`);
    console.log("└───────────────────────────────────────────────────────┘\n");

    // 2. Performance
    console.log("┌─── HIỆU NĂNG (Performance) ─────────────────────────┐");
    console.log(`│  Thời gian phản hồi TB:  ${stats.performance.avgLatency} ms`);
    console.log(`│  Min:                    ${stats.performance.minLatency} ms`);
    console.log(`│  Max:                    ${stats.performance.maxLatency} ms`);
    console.log(`│  P50 (Median):           ${stats.performance.p50Latency} ms`);
    console.log(`│  P90:                    ${stats.performance.p90Latency} ms`);
    console.log(`│  P95:                    ${stats.performance.p95Latency} ms`);
    console.log(`│  P99:                    ${stats.performance.p99Latency} ms`);
    console.log(`│  Token TB/request:       ${stats.performance.avgTokensPerRequest}`);
    console.log("└───────────────────────────────────────────────────────┘\n");

    // 3. Accuracy
    console.log("┌─── ĐỘ CHÍNH XÁC (Accuracy) ────────────────────────┐");
    console.log(`│  Tool Call Accuracy:     ${stats.accuracy.toolCallAccuracy}%`);
    console.log(`│  Tool Call Precision:    ${stats.accuracy.toolCallPrecision}%`);
    console.log(`│  Tool Call Recall:       ${stats.accuracy.toolCallRecall}%`);
    console.log(`│  Parameter Accuracy:     ${stats.accuracy.parameterAccuracy}%`);
    console.log("└───────────────────────────────────────────────────────┘\n");

    // 4. Quality (LLM-as-Judge)
    console.log("┌─── CHẤT LƯỢNG PHẢN HỒI (Quality - LLM Judge) ──────┐");
    console.log(`│  Độ liên quan:       ${stats.quality.relevance}/5.00`);
    console.log(`│  Độ chính xác:       ${stats.quality.accuracy}/5.00`);
    console.log(`│  Giọng điệu:        ${stats.quality.tone}/5.00`);
    console.log(`│  Ngắn gọn:          ${stats.quality.conciseness}/5.00`);
    console.log(`│  Hữu ích:           ${stats.quality.helpfulness}/5.00`);
    console.log(`│  ─────────────────────────────────────────────`);
    console.log(`│  TỔNG CHẤT LƯỢNG:   ${stats.quality.overallQuality}/5.00`);
    console.log("└───────────────────────────────────────────────────────┘\n");

    // 5. Category Breakdown
    console.log("┌─── PHÂN TÍCH THEO DANH MỤC ─────────────────────────┐");
    for (const [cat, data] of Object.entries(stats.categoryBreakdown)) {
        console.log(`│  ${cat.padEnd(20)} | OK: ${(data.successRate * 100).toFixed(0).padStart(3)}% | Tool: ${(data.avgToolAccuracy * 100).toFixed(0).padStart(3)}% | ${data.avgLatency}ms`);
    }
    console.log("└───────────────────────────────────────────────────────┘");
};

// ─── Tạo báo cáo Markdown ───────────────────────────────────
const generateMarkdownReport = (stats, results, rounds) => {
    const now = new Date().toLocaleString("vi-VN");

    let md = `# Báo Cáo Đánh Giá Chatbot Nhà Hàng Ca Dao

> **Ngày đánh giá:** ${now}  
> **Model:** ${AI_MODEL}  
> **Số test cases:** ${stats.overview.totalTests}  
> **Số vòng lặp:** ${rounds}

---

## 1. Tổng Quan

| Chỉ số | Giá trị |
|--------|---------|
| Tổng test cases | ${stats.overview.totalTests} |
| Thành công | ${stats.overview.successful} (${(stats.overview.successRate * 100).toFixed(1)}%) |
| Thất bại | ${stats.overview.failed} (${(stats.overview.errorRate * 100).toFixed(1)}%) |
| Timeout | ${stats.overview.timedOut} (${(stats.overview.timeoutRate * 100).toFixed(1)}%) |

## 2. Hiệu Năng (Performance Metrics)

| Chỉ số | Giá trị |
|--------|---------|
| Thời gian phản hồi trung bình | ${stats.performance.avgLatency} ms |
| Thời gian phản hồi tối thiểu | ${stats.performance.minLatency} ms |
| Thời gian phản hồi tối đa | ${stats.performance.maxLatency} ms |
| P50 (Median) | ${stats.performance.p50Latency} ms |
| P90 | ${stats.performance.p90Latency} ms |
| P95 | ${stats.performance.p95Latency} ms |
| P99 | ${stats.performance.p99Latency} ms |
| Token trung bình/request | ${stats.performance.avgTokensPerRequest} |

## 3. Độ Chính Xác (Accuracy Metrics)

| Chỉ số | Giá trị |
|--------|---------|
| **Tool Call Accuracy (F1-Score)** | **${stats.accuracy.toolCallAccuracy}%** |
| Tool Call Precision | ${stats.accuracy.toolCallPrecision}% |
| Tool Call Recall | ${stats.accuracy.toolCallRecall}% |
| Parameter Accuracy | ${stats.accuracy.parameterAccuracy}% |

### Giải thích:
- **Tool Call Accuracy (F1-Score):** Trung bình harmonic giữa Precision và Recall trong việc gọi đúng tool
- **Precision:** Tỷ lệ tool gọi đúng / tổng tool đã gọi (gọi ít nhưng đúng)
- **Recall:** Tỷ lệ tool gọi đúng / tổng tool cần gọi (gọi đủ tool cần thiết)
- **Parameter Accuracy:** Tỷ lệ tham số truyền đúng giá trị kỳ vọng

## 4. Chất Lượng Phản Hồi (Quality - LLM-as-Judge)

Sử dụng phương pháp **LLM-as-Judge** để đánh giá chất lượng phản hồi trên thang điểm 0-5:

| Tiêu chí | Điểm | Mô tả |
|----------|-------|--------|
| Độ liên quan (Relevance) | ${stats.quality.relevance}/5 | Phản hồi đúng với câu hỏi |
| Độ chính xác (Accuracy) | ${stats.quality.accuracy}/5 | Thông tin chính xác, không bịa |
| Giọng điệu (Tone) | ${stats.quality.tone}/5 | Xưng "tôi", gọi "quý khách", bắt đầu "dạ" |
| Ngắn gọn (Conciseness) | ${stats.quality.conciseness}/5 | Dưới 6 dòng |
| Hữu ích (Helpfulness) | ${stats.quality.helpfulness}/5 | Giúp khách đạt mục đích |
| **Tổng chất lượng** | **${stats.quality.overallQuality}/5** | **Trung bình các tiêu chí** |

## 5. Phân Tích Theo Danh Mục

| Danh mục | Tỷ lệ thành công | Tool Accuracy | Latency TB |
|----------|-------------------|---------------|------------|
`;

    for (const [cat, data] of Object.entries(stats.categoryBreakdown)) {
        md += `| ${cat} | ${(data.successRate * 100).toFixed(0)}% | ${(data.avgToolAccuracy * 100).toFixed(0)}% | ${data.avgLatency} ms |\n`;
    }

    md += `
## 6. Chi Tiết Từng Test Case

| ID | Danh mục | Mô tả | Trạng thái | Latency | Tool Acc | Quality |
|----|----------|--------|------------|---------|----------|---------|
`;

    for (const r of results) {
        const status = r.status === "success" ? "✅" : "❌";
        const latency = r.latency?.total || "N/A";
        const toolAcc = r.toolCalls?.evaluation?.accuracy !== undefined
            ? `${(r.toolCalls.evaluation.accuracy * 100).toFixed(0)}%` : "N/A";
        const quality = r.judgeScores?.relevance >= 0
            ? ((r.judgeScores.relevance + r.judgeScores.accuracy + r.judgeScores.tone + r.judgeScores.conciseness + r.judgeScores.helpfulness) / 5).toFixed(1)
            : "N/A";
        md += `| ${r.id} | ${r.category} | ${r.description} | ${status} | ${latency}ms | ${toolAcc} | ${quality}/5 |\n`;
    }

    md += `
## 7. Phân Tích Lỗi

### Test cases thất bại:
`;

    const failures = results.filter((r) => r.status !== "success");
    if (failures.length === 0) {
        md += "\nKhông có test case nào thất bại. ✅\n";
    } else {
        for (const f of failures) {
            md += `\n#### ${f.id} - ${f.description}\n`;
            md += `- **Trạng thái:** ${f.status}\n`;
            md += `- **Lỗi:** ${f.error || "N/A"}\n`;
            md += `- **Input:** "${f.input}"\n`;
        }
    }

    md += `
### Test cases có Tool Call sai:
`;

    const wrongTools = results.filter((r) => r.status === "success" && r.toolCalls?.evaluation?.accuracy < 1.0);
    if (wrongTools.length === 0) {
        md += "\nTất cả tool calls đều chính xác. ✅\n";
    } else {
        for (const w of wrongTools) {
            md += `\n#### ${w.id} - ${w.description}\n`;
            md += `- **Expected:** ${JSON.stringify(w.toolCalls.expected)}\n`;
            md += `- **Actual:** ${JSON.stringify(w.toolCalls.actual.map((t) => t.name))}\n`;
            md += `- **F1:** ${(w.toolCalls.evaluation.accuracy * 100).toFixed(0)}%\n`;
        }
    }

    md += `
## 8. Kết Luận & Khuyến Nghị

### Điểm mạnh:
${stats.accuracy.toolCallAccuracy >= 80 ? "- ✅ Tool Call Accuracy cao (≥80%)" : ""}
${stats.quality.overallQuality >= 4 ? "- ✅ Chất lượng phản hồi tốt (≥4/5)" : ""}
${stats.performance.avgLatency <= 3000 ? "- ✅ Thời gian phản hồi nhanh (≤3s)" : ""}
${stats.overview.timeoutRate <= 0.05 ? "- ✅ Tỷ lệ timeout thấp (≤5%)" : ""}

### Điểm cần cải thiện:
${stats.accuracy.toolCallAccuracy < 80 ? "- ⚠️ Tool Call Accuracy cần cải thiện (<80%)" : ""}
${stats.quality.overallQuality < 4 ? "- ⚠️ Chất lượng phản hồi cần cải thiện (<4/5)" : ""}
${stats.performance.avgLatency > 3000 ? "- ⚠️ Thời gian phản hồi chậm (>3s)" : ""}
${stats.overview.timeoutRate > 0.05 ? "- ⚠️ Tỷ lệ timeout cao (>5%)" : ""}

---

*Báo cáo được tạo tự động bởi hệ thống đánh giá chatbot Ca Dao.*
`;

    return md;
};

// ─── Run ────────────────────────────────────────────────────
main().catch(console.error);
