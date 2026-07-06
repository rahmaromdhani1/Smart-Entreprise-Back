import express from "express";
import { sensorStore } from "../sensorStore.js"; // ← import ES Module

const router = express.Router();

router.get("/dashboard", (req, res) => {
  const stats = {
    energy: {
      value:  sensorStore.energie,
      unit:   "kWh",
      change: 0,
      trend:  "up"
    },
    puissance: {
      value: sensorStore.puissance,
      unit:  "W"
    },
    tension: {
      value: sensorStore.tension,
      unit:  "V"
    },
    luminosite: {
      value:      sensorStore.lightLevel,
      unit:       "%",
      blinds:     sensorStore.blinds,
      lampsState: sensorStore.lampsState,
      lampsPWM:   sensorStore.lampsPWM
    },
    alerts: {
      count:  sensorStore.lightLevel === 0 ? 1 : 0,
      change: 0,
      trend:  "down"
    }
  };

  const iotDistribution = {
    lights: sensorStore.lampsState === "on" ? sensorStore.lampsPWM : 0,
    blinds: sensorStore.blinds === "open" ? 100 : 0,
    others: 0,
    total:  32
  };

  res.json({ stats, iotDistribution, lastUpdate: sensorStore.lastUpdate });
});

export default router;