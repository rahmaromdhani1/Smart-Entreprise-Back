import mongoose from "mongoose";

const VALID_SENSOR_TYPES = [
  "temperature",
  "humidity",
  "light",
  "pressure",
  "co2",
  "motion",
];

const TYPE_CONFIG = {
  temperature: { unit: "°C", hardMin: -10, hardMax: 60 },
  humidity: { unit: "%", hardMin: 0, hardMax: 100 },
  light: { unit: "lux", hardMin: 0, hardMax: 200000 },
  pressure: { unit: "hPa", hardMin: 300, hardMax: 1100 },
  co2: { unit: "ppm", hardMin: 0, hardMax: 50000 },
  motion: { unit: "state", hardMin: 0, hardMax: 1 },
};

const ThresholdSchema = new mongoose.Schema(
  {
    min: {
      type: Number,
      required: [true, "Threshold min is required"],
    },
    max: {
      type: Number,
      required: [true, "Threshold max is required"],
    },
    threshold: {
      type: Number,
      required: [true, "Threshold is required"],
    },
    hysteresis: {
      type: Number,
      required: [true, "Threshold hysteresis is required"],
      min: [0, "Hysteresis must be >= 0"],
    },
    mode: {
      type: String,
      enum: {
        values: ["ai", "user", "locked"],
        message: "Mode must be one of: ai, user, locked",
      },
      default: "ai",
    },
    confidence: {
      type: Number,
      required: [true, "Confidence is required"],
      min: [0, "Confidence must be >= 0"],
      max: [1, "Confidence must be <= 1"],
    },
    reason: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "Reason must not exceed 300 characters"],
    },
  },
  { _id: false }
);

const SeuilSchema = new mongoose.Schema(
  {
    equipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipment",
      required: [true, "Equipment ID is required"],
      unique: true,
      index: true,
    },

    nodeId: {
      type: String,
      required: [true, "Node ID is required"],
      unique: true,
      uppercase: true,
      trim: true,
      match: [
        /^[A-Z0-9][A-Z0-9\-_]{1,29}$/,
        "Node ID must be 2-30 alphanumeric characters (hyphens and underscores allowed)",
      ],
    },

    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
      minlength: [2, "Location must be at least 2 characters"],
      maxlength: [100, "Location must not exceed 100 characters"],
    },

    thresholds: {
      type: Map,
      of: ThresholdSchema,
      required: true,
      default: {},
      validate: {
        validator: function (value) {
          const keys = Array.from(value.keys());
          return keys.every((key) => VALID_SENSOR_TYPES.includes(key));
        },
        message: `Threshold keys must be one of: ${VALID_SENSOR_TYPES.join(", ")}`,
      },
    },

    meta: {
      usedSensorData: {
        type: Boolean,
        default: false,
      },
      weatherAvailable: {
        type: Boolean,
        default: false,
      },
      generatedAt: {
        type: Date,
        default: Date.now,
      },
      provider: {
        type: String,
        trim: true,
        default: "groq",
      },
      model: {
        type: String,
        trim: true,
        default: "",
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SeuilSchema.pre("validate", function (next) {
  for (const [sensorType, threshold] of this.thresholds.entries()) {
    const config = TYPE_CONFIG[sensorType];

    if (!config) {
      return next(new Error(`Unknown sensor type: ${sensorType}`));
    }

    if (threshold.min > threshold.max) {
      return next(
        new Error(`${sensorType}: min cannot be greater than max`)
      );
    }

    if (threshold.threshold < threshold.min || threshold.threshold > threshold.max) {
      return next(
        new Error(`${sensorType}: threshold must be between min and max`)
      );
    }

    if (threshold.min < config.hardMin || threshold.min > config.hardMax) {
      return next(
        new Error(
          `${sensorType}: min must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
        )
      );
    }

    if (threshold.max < config.hardMin || threshold.max > config.hardMax) {
      return next(
        new Error(
          `${sensorType}: max must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
        )
      );
    }

    if (threshold.threshold < config.hardMin || threshold.threshold > config.hardMax) {
      return next(
        new Error(
          `${sensorType}: threshold must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
        )
      );
    }
  }

  next();
});

const Seuil = mongoose.model("Seuil", SeuilSchema);
export default Seuil;