import mongoose from "mongoose";

const alertSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  level: {
    type: String,
    enum: ["info", "warning", "critical"],
    default: "info"
  },
  message: {
    type: String,
    required: true
  },
  seen: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Alert", alertSchema);
