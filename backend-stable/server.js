
const express = require("express");
const app = express();

app.get("/api", (req, res) => {
    res.json({
        backend: "stable",
        message: "Everything working perfectly"
    });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Stable backend running on port ${PORT}.`);
});
