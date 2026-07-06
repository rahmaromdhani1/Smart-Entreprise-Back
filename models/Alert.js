import mongoose from "mongoose";

const alertSchema = new mongoose.Schema({
  // deviceId = mac address — rendu optionnel car BackM utilise meta.mac
  deviceId: {
    type: String,
    default: null,
  },
  type: {
    type: String,
    required: true,
  },
  level: {
    type: String,
    enum: ["info", "warning", "critical"],
    default: "info",
  },
  message: {
    type: String,
    required: true,
  },
  // Données brutes de l'anomalie (rempli par BackM)
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  seen: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Alert", alertSchema);