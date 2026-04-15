const express = require("express");
const app = express();

app.use(express.json());

// ========== HEALTH CHECK ==========
app.get("/health", (req, res) => {
  res.json({ status: "healthy", backend: "stable", timestamp: new Date().toISOString() });
});

// ========== API ENDPOINT ==========
app.get("/api", (req, res) => {
  res.json({
    backend: "stable",
    message: "Everything working perfectly"
  });
});

// ========== CATCH ALL OTHER ROUTES ==========
app.all("*", (req, res) => {
  res.json({
    backend: "stable",
    message: "Everything working perfectly",
    method: req.method,
    path: req.path
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`✅ Stable backend running on port ${PORT}.`);
});