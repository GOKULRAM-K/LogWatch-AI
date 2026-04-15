const { retrieveRelevantLogs } = require("../rag/retriever");
const { runExecutionAgent } = require("./execute-actions");
const { setAIState } = require("./ai-state");

// ==============================
// FALLBACK AI DECISION (CRITICAL)
// ==============================
function buildFallbackAI(errorRate, stats) {
  return {
    errors: [
      {
        code: errorRate > 20 ? "500" : "200",
        backend: errorRate > 20 ? "canary" : "stable",
        cause: `System experiencing ${errorRate}% error rate`,
        fix:
          errorRate > 20
            ? "Rollback to stable backend and inspect canary"
            : "System healthy, monitor only",
        severity: errorRate > 30 ? "HIGH" : "LOW",
      },
    ],
    actions:
      errorRate > 20
        ? ["ROLLBACK"]
        : errorRate > 5
        ? ["MONITOR"]
        : ["IGNORE"],
    risk:
      errorRate > 30
        ? "HIGH"
        : errorRate > 10
        ? "MEDIUM"
        : "LOW",
    recommendation:
      errorRate > 20
        ? "Immediate rollback recommended"
        : "System stable",
  };
}

// ==============================
// SMART FALLBACK LOG BUILDER
// ==============================
function buildFallbackLogs(stats, errorRate) {
  const logs = [];

  if (errorRate >= 20) {
    logs.push({
      statusCode: 502,
      path: "/api",
      responseBody: {
        message: `High error rate detected: ${errorRate}%`,
      },
    });
  } else if (errorRate > 0) {
    logs.push({
      statusCode: 404,
      path: "/api",
      responseBody: {
        message: `Minor errors detected`,
      },
    });
  } else {
    logs.push({
      statusCode: 200,
      path: "/api",
      responseBody: {
        message: `System healthy`,
      },
    });
  }

  return logs;
}

// ==============================
// MAIN ANALYSIS AGENT
// ==============================
async function runAnalysisAgent({ errorRate, stats }) {
  console.log("🧠 AnalysisAgent starting...");

  try {
    let relevantLogs = [];

    // ==============================
    // STEP 1: Try RAG
    // ==============================
    try {
      relevantLogs = await retrieveRelevantLogs(
        "errors failures 500 502 503 timeout"
      );
    } catch (e) {
      console.warn("RAG failed:", e.message);
    }

    // ==============================
    // STEP 2: Fallback logs
    // ==============================
    if (!relevantLogs || relevantLogs.length === 0) {
      relevantLogs = buildFallbackLogs(stats, errorRate);
    }

    const logSummary = relevantLogs
      .map(
        (l) =>
          `Status:${l.statusCode} Path:${l.path} Message:${JSON.stringify(
            l.responseBody
          )}`
      )
      .join("\n");

    // ==============================
    // STEP 3: GROQ CALL
    // ==============================
    let ai;

    try {
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
            messages: [
              {
                role: "user",
                content: `Analyze logs and return JSON only:\n${logSummary}`,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        console.error("Groq failed");
        ai = buildFallbackAI(errorRate, stats);
      } else {
        const data = await response.json();

        try {
          const raw = data.choices[0].message.content;
          const json = raw.substring(
            raw.indexOf("{"),
            raw.lastIndexOf("}") + 1
          );
          ai = JSON.parse(json);
        } catch {
          ai = buildFallbackAI(errorRate, stats);
        }
      }
    } catch (err) {
      console.error("Groq error:", err.message);
      ai = buildFallbackAI(errorRate, stats);
    }

    // ==============================
    // SAFETY CHECK
    // ==============================
    if (!ai || !ai.actions) {
      ai = buildFallbackAI(errorRate, stats);
    }

    console.log("✅ FINAL AI:", ai);

    // ==============================
    // SAVE STATE
    // ==============================
    setAIState({
      ...ai,
      errorRate,
      stats,
      timestamp: Date.now(),
    });

    // ==============================
    // EXECUTE ACTIONS (CRITICAL)
    // ==============================
    await runExecutionAgent({
      actions: ai.actions,
      errors: ai.errors,
      risk: ai.risk,
      recommendation: ai.recommendation,
      errorRate,
      stats,
    });

    console.log("🚀 ExecutionAgent triggered");

    return ai;
  } catch (err) {
    console.error("FINAL FAIL:", err.message);

    const fallback = buildFallbackAI(errorRate, stats);

    await runExecutionAgent({
      actions: fallback.actions,
      errors: fallback.errors,
      risk: fallback.risk,
      recommendation: fallback.recommendation,
      errorRate,
      stats,
    });

    return fallback;
  }
}

module.exports = { runAnalysisAgent };