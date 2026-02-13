import express from "express";
import Alert from "../models/Alert.js";

const router = express.Router();

// 1️⃣ Simuler une alerte (sans IoT)
router.post("/simulate", async (req, res) => {
  try {
    const alert = await Alert.create(req.body);
    req.app.get("io").emit("new-alert", alert);
    io.emit("new-alert", alert.toJSON());
    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2️⃣ Récupérer l'historique
router.get("/", async (req, res) => {
  const alerts = await Alert.find()
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(alerts);
});

export default router;
