import { body, param, query, validationResult } from "express-validator";

const VALID_SENSOR_TYPES = [
  "temperature",
  "humidity",
  "light",
  "pressure",
  "co2",
  "motion",
];

const VALID_MODES = ["ai", "user", "locked"];
const VALID_PROVIDERS = ["groq", "openai", "gemini", "ollama"];

const TYPE_CONFIG = {
  temperature: { unit: "°C", hardMin: -10, hardMax: 60 },
  humidity: { unit: "%", hardMin: 0, hardMax: 100 },
  light: { unit: "lux", hardMin: 0, hardMax: 200000 },
  pressure: { unit: "hPa", hardMin: 300, hardMax: 1100 },
  co2: { unit: "ppm", hardMin: 0, hardMax: 50000 },
  motion: { unit: "state", hardMin: 0, hardMax: 1 },
};

const CTRL = "[SeuilValidator]";

const logWarn = (message, extra = null) => {
  if (extra) console.warn(`${CTRL} ${message}`, extra);
  else console.warn(`${CTRL} ${message}`);
};

export const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
      value: e.value,
    }));

    logWarn("Validation failed", {
      method: req.method,
      url: req.originalUrl,
      errors: formatted,
    });

    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: formatted,
    });
  }

  next();
};

/**
 * Generic param validator
 */
export const equipmentIdParamRules = [
  param("equipmentId")
    .exists({ checkFalsy: true })
    .withMessage("equipmentId is required")
    .bail()
    .isMongoId()
    .withMessage("equipmentId must be a valid Mongo ObjectId"),
];

/**
 * Optional query validation for GET /api/seuils
 */
export const getAllSeuilProfilesQueryRules = [
  query("equipmentId")
    .optional()
    .isMongoId()
    .withMessage("equipmentId must be a valid Mongo ObjectId"),

  query("nodeId")
    .optional()
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9][A-Z0-9\-_]{1,29}$/)
    .withMessage(
      "nodeId must be 2-30 alphanumeric characters (hyphens and underscores allowed)"
    ),

  query("location")
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("location must be between 1 and 100 characters"),

  query("provider")
    .optional()
    .trim()
    .isIn(VALID_PROVIDERS)
    .withMessage(`provider must be one of: ${VALID_PROVIDERS.join(", ")}`),

  query("usedSensorData")
    .optional()
    .isBoolean()
    .withMessage("usedSensorData must be a boolean"),

  query("weatherAvailable")
    .optional()
    .isBoolean()
    .withMessage("weatherAvailable must be a boolean"),

  query("sensorType")
    .optional()
    .isIn(VALID_SENSOR_TYPES)
    .withMessage(`sensorType must be one of: ${VALID_SENSOR_TYPES.join(", ")}`),

  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page must be an integer >= 1")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be an integer between 1 and 100")
    .toInt(),

  query("sortBy")
    .optional()
    .isIn(["createdAt", "updatedAt", "nodeId", "location"])
    .withMessage("sortBy must be one of: createdAt, updatedAt, nodeId, location"),

  query("order")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage("order must be either asc or desc"),
];

/**
 * Reusable nested threshold object validation
 */
const validateThresholdsObject = (thresholds) => {
  if (
    !thresholds ||
    typeof thresholds !== "object" ||
    Array.isArray(thresholds)
  ) {
    throw new Error("thresholds must be a non-array object");
  }

  const entries = Object.entries(thresholds);

  if (entries.length === 0) {
    throw new Error("thresholds must contain at least one sensor threshold");
  }

  for (const [sensorType, threshold] of entries) {
    if (!VALID_SENSOR_TYPES.includes(sensorType)) {
      throw new Error(
        `Unsupported threshold key "${sensorType}". Allowed keys: ${VALID_SENSOR_TYPES.join(", ")}`
      );
    }

    if (!threshold || typeof threshold !== "object" || Array.isArray(threshold)) {
      throw new Error(`${sensorType} threshold must be an object`);
    }

    const requiredKeys = ["min", "max", "threshold", "hysteresis", "confidence"];
    for (const key of requiredKeys) {
      if (threshold[key] === undefined || threshold[key] === null || threshold[key] === "") {
        throw new Error(`${sensorType}.${key} is required`);
      }
      if (!Number.isFinite(Number(threshold[key]))) {
        throw new Error(`${sensorType}.${key} must be a valid number`);
      }
    }

    const min = Number(threshold.min);
    const max = Number(threshold.max);
    const thresholdValue = Number(threshold.threshold);
    const hysteresis = Number(threshold.hysteresis);
    const confidence = Number(threshold.confidence);

    const cfg = TYPE_CONFIG[sensorType];

    if (min > max) {
      throw new Error(`${sensorType}: min cannot be greater than max`);
    }

    if (thresholdValue < min || thresholdValue > max) {
      throw new Error(`${sensorType}: threshold must be between min and max`);
    }

    if (hysteresis < 0) {
      throw new Error(`${sensorType}: hysteresis must be >= 0`);
    }

    if (confidence < 0 || confidence > 1) {
      throw new Error(`${sensorType}: confidence must be between 0 and 1`);
    }

    if (min < cfg.hardMin || min > cfg.hardMax) {
      throw new Error(
        `${sensorType}: min must be between ${cfg.hardMin} and ${cfg.hardMax} ${cfg.unit}`
      );
    }

    if (max < cfg.hardMin || max > cfg.hardMax) {
      throw new Error(
        `${sensorType}: max must be between ${cfg.hardMin} and ${cfg.hardMax} ${cfg.unit}`
      );
    }

    if (threshold < cfg.hardMin || threshold > cfg.hardMax) {
      throw new Error(
        `${sensorType}: threshold must be between ${cfg.hardMin} and ${cfg.hardMax} ${cfg.unit}`
      );
    }

    if (
      threshold.mode !== undefined &&
      !VALID_MODES.includes(String(threshold.mode))
    ) {
      throw new Error(
        `${sensorType}: mode must be one of ${VALID_MODES.join(", ")}`
      );
    }

    if (
      threshold.reason !== undefined &&
      typeof threshold.reason !== "string"
    ) {
      throw new Error(`${sensorType}: reason must be a string`);
    }

    if (
      typeof threshold.reason === "string" &&
      threshold.reason.length > 300
    ) {
      throw new Error(`${sensorType}: reason must not exceed 300 characters`);
    }
  }

  return true;
};

/**
 * PUT /api/seuils/equipment/:equipmentId
 * Manual profile update
 */
export const updateSeuilProfileRules = [
  ...equipmentIdParamRules,

  body("location")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("location must be between 2 and 100 characters"),

  body("thresholds")
    .optional()
    .custom((value) => validateThresholdsObject(value)),

  body("meta")
    .optional()
    .custom((meta) => {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        throw new Error("meta must be an object");
      }

      if (
        meta.usedSensorData !== undefined &&
        typeof meta.usedSensorData !== "boolean"
      ) {
        throw new Error("meta.usedSensorData must be a boolean");
      }

      if (
        meta.weatherAvailable !== undefined &&
        typeof meta.weatherAvailable !== "boolean"
      ) {
        throw new Error("meta.weatherAvailable must be a boolean");
      }

      if (
        meta.generatedAt !== undefined &&
        Number.isNaN(Date.parse(meta.generatedAt))
      ) {
        throw new Error("meta.generatedAt must be a valid date");
      }

      if (
        meta.provider !== undefined &&
        !VALID_PROVIDERS.includes(String(meta.provider))
      ) {
        throw new Error(
          `meta.provider must be one of: ${VALID_PROVIDERS.join(", ")}`
        );
      }

      if (
        meta.model !== undefined &&
        typeof meta.model !== "string"
      ) {
        throw new Error("meta.model must be a string");
      }

      return true;
    }),

  body().custom((body) => {
    const allowedTopLevel = ["location", "thresholds", "meta"];
    const keys = Object.keys(body || {});
    const hasAtLeastOne = keys.some((k) => allowedTopLevel.includes(k));

    if (!hasAtLeastOne) {
      throw new Error(
        "At least one of these fields must be provided: location, thresholds, meta"
      );
    }

    return true;
  }),
];


export const regenerateSeuilProfileRules = [...equipmentIdParamRules];


export const getSeuilProfileByEquipmentIdRules = [...equipmentIdParamRules];