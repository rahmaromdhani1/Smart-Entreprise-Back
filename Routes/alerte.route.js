import express from "express";
import Alert from "../models/Alert.js";

const router = express.Router();

// 1️⃣ Simuler une alerte manuellement (sans IoT)
router.post("/simulate", async (req, res) => {
  try {
    const alert = await Alert.create(req.body);

    // ✅ Correction : io récupéré depuis app, pas une variable globale undefined
    const io = req.app.get("io");
    io.emit("new-alert", alert.toJSON());

    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2️⃣ Récupérer l'historique des alertes
router.get("/", async (req, res) => {
  try {
    if (req.query.today === "1" && req.query.count === "1") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const count = await Alert.countDocuments({ createdAt: { $gte: start, $lt: end } });
      return res.json({ count });
    }

    const query = {};
    if (req.query.today === "1") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query.createdAt = { $gte: start, $lt: end };
    }

    const alerts = await Alert.find(query)
      .sort({ createdAt: -1 })
      .limit(req.query.today === "1" ? 500 : 50);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.patch("/:id/seen", async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { seen: true },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
