import mongoose from "mongoose";

const VALID_SENSOR_TYPES = [
  "temperature",
  "humidity",
  "light",
  "pressure",
  "smoke",
  "motion",
];

const TYPE_CONFIG = {
  temperature: { unit: "°C", hardMin: -10, hardMax: 60 },
  humidity: { unit: "%", hardMin: 0, hardMax: 100 },
  light: { unit: "lux", hardMin: 0, hardMax: 200000 },
  pressure: { unit: "hPa", hardMin: 300, hardMax: 1100 },
  smoke: { unit: "ppm", hardMin: 0, hardMax: 50000 },
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
      default: 0,
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
      default: 0.5,
      min: 0,
      max: 1,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "Reason must not exceed 300 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description must not exceed 500 characters"],
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

    floor: {
      type: String,
      trim: true,
      default: "",
      maxlength: [100, "Floor must not exceed 100 characters"],
    },

    officeRoom: {
      type: String,
      trim: true,
      default: "",
      maxlength: [100, "officeRoom must not exceed 100 characters"],
    },

    thresholds: {
      type: Map,
      of: ThresholdSchema,
      required: true,
      default: {},
      validate: {
        validator: function (value) {
          const keys = value instanceof Map
            ? Array.from(value.keys())
            : Object.keys(value || {});
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

// ── pre("validate") ────────────────────────────────────────────────────────────
// Using async (no next parameter) is the correct pattern when the hook can
// throw — Mongoose/Kareem handles the rejection automatically.
// Using function(next) + throw causes "next is not a function" because Kareem
// catches the throw at line 63 and tries to call next(err), but by that point
// next is out of scope / undefined in certain Mongoose versions.
SeuilSchema.pre("validate", async function () {
  // Normalize: if thresholds was assigned as a plain object (e.g. from req.body),
  // convert it to a Map so .entries() works reliably below.
  if (this.thresholds && !(this.thresholds instanceof Map)) {
    this.thresholds = new Map(Object.entries(this.thresholds));
  }

  for (const [sensorType, threshold] of this.thresholds.entries()) {
    const config = TYPE_CONFIG[sensorType];

    if (!config) {
      throw new Error(`Unknown sensor type: ${sensorType}`);
    }

    const min   = threshold.min;
    const max   = threshold.max;
    const value = threshold.threshold;

    if (min == null || max == null || value == null) {
      throw new Error(`${sensorType}: missing required values`);
    }

    if (min > max) {
      throw new Error(`${sensorType}: min cannot be greater than max`);
    }

    if (value < min || value > max) {
      throw new Error(`${sensorType}: threshold must be between min and max`);
    }

    if (min < config.hardMin || min > config.hardMax) {
      throw new Error(
        `${sensorType}: min must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
      );
    }

    if (max < config.hardMin || max > config.hardMax) {
      throw new Error(
        `${sensorType}: max must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
      );
    }

    if (value < config.hardMin || value > config.hardMax) {
      throw new Error(
        `${sensorType}: threshold must be between ${config.hardMin} and ${config.hardMax} ${config.unit}`
      );
    }
  }
  // No next() call needed — async hooks resolve/reject automatically
});

const Seuil = mongoose.model("Seuil", SeuilSchema);
export default Seuil;