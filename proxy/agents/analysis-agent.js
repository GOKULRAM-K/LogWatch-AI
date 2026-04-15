const { retrieveRelevantLogs } = require("../rag/retriever");
const { runExecutionAgent } = require("./execute-actions");
const { setAIState } = require("./ai-state");
const EnhancedLogger = require("../enhanced-logger");

async function runAnalysisAgent({ errorRate, stats }) {
  console.log("🧠 AnalysisAgent: starting analysis...");

  try {
    // ==============================
    // STEP 1: Get logs directly from logger (not just RAG)
    // ==============================
    const logger = new EnhancedLogger();
    const allLogs = logger.getTodayLogs() || [];

    // Filter only error logs with real messages
    const errorLogs = allLogs
      .filter((l) => l.statusCode >= 400)
      .slice(-50); // last 50 errors

    let relevantLogs = [];

    try {
      relevantLogs = await retrieveRelevantLogs(
        "errors failures crashes 500 502 503 504 timeout database db error exception"
      );
      console.log("🔍 RAG logs retrieved:", relevantLogs.length);
    } catch (e) {
      console.warn("[AnalysisAgent] RAG failed:", e.message);
    }

    // Merge: prefer direct logs (they have responseBody), fallback to RAG
    const combined = errorLogs.length > 0 ? errorLogs : relevantLogs;

    if (!combined || combined.length === 0) {
      console.warn("[AnalysisAgent] No logs to analyze");
      return null;
    }

    const topLogs = combined.slice(0, 20);

    // ==============================
    // STEP 2: Build rich log summary for Groq
    // ==============================
    const logSummary = topLogs.map((l) => {
      let msg = "Unknown";

      if (typeof l.responseBody === "string") {
        msg = l.responseBody;
      } else if (l.responseBody?.message) {
        msg = l.responseBody.message;
      } else if (l.responseBody?.error) {
        msg = l.responseBody.error;
      }

      return `Status:${l.statusCode} Path:${l.path || "/api"} Message:"${msg.substring(0, 150)}"`;
    }).join("\n");

    console.log("📋 Log summary for AI:\n", logSummary);

    // ==============================
    // STEP 3: AI PROMPT with real error messages
    // ==============================
    const prompt = `
You are an autonomous SRE incident analysis agent.

Analyze these REAL error logs and return ONLY valid JSON.

RULES:
- You MUST output exactly 4 error entries in the array
- Use the EXACT error messages from the logs below — do NOT be generic
- Each error entry must reference the specific error message seen in logs
- Rank by severity (HIGH first)
- Do NOT output any words, markdown, or text before or after the JSON

STRICT FORMAT:
{
  "errors": [
    {
      "code": "500",
      "backend": "test",
      "cause": "specific cause based on the actual log message",
      "fix": "specific fix for this exact error",
      "severity": "LOW | MEDIUM | HIGH"
    }
  ],
  "actions": ["ROLLBACK", "RESTART_SERVICE", "IGNORE"],
  "risk": "LOW | MEDIUM | HIGH",
  "recommendation": "specific recommendation based on actual errors seen"
}

IMPORTANT RULES:
- If errorRate > 20 → include "ROLLBACK"
- If repeated 500 errors → include "RESTART_SERVICE"
- Always include at least one action
- "cause" and "fix" MUST reference the actual error messages below, not generic text

ACTUAL ERROR LOGS:
${logSummary}

Error Rate: ${errorRate}%
Total Requests: ${stats.totalRequests}
Total Errors: ${stats.totalErrors}
`;

    // ==============================
    // STEP 4: CALL GROQ
    // ==============================
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      }
    );

    const data = await response.json();

    if (!data.choices?.length) {
      console.error("[AnalysisAgent] Groq failed:", data);
      return null;
    }

    // ==============================
    // STEP 5: SAFE JSON PARSE
    // ==============================
    let ai;

    try {
      const raw = data.choices[0].message.content.trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("No JSON object found");
      const cleaned = raw.substring(start, end + 1);
      ai = JSON.parse(cleaned);
    } catch (e) {
      console.error("[AnalysisAgent] JSON parse failed");
      console.log("RAW OUTPUT:", data.choices[0].message.content);
      return null;
    }

    if (!ai || !ai.actions) {
      console.warn("[AnalysisAgent] Invalid AI response");
      return null;
    }

    console.log("🧠 AI Decision:\n", JSON.stringify(ai, null, 2));

    // ==============================
    // STEP 6: UPDATE AI STATE
    // ==============================
    setAIState({
      ...ai,
      errorRate,
      stats,
      logsAnalyzed: topLogs.length,
      timestamp: Date.now(),
    });

    // ==============================
    // STEP 7: EXECUTE ACTIONS
    // ==============================
    await runExecutionAgent({
      actions: ai.actions,
      errors: ai.errors,
      risk: ai.risk,
      recommendation: ai.recommendation,
      errorRate,
      stats,
    });

    console.log("✅ AnalysisAgent complete → ExecutionAgent triggered");

    return ai;

  } catch (err) {
    console.error("[AnalysisAgent ERROR]", err.message);
    return null;
  }
}

module.exports = { runAnalysisAgent };