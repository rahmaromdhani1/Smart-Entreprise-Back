//Controllers/seuilController.js
import mongoose from "mongoose";
import Seuil from "../models/Seuil.js";
import Equipment from "../models/Equipment.js";
import { requestThresholdProfileFromBackM } from "../services/AiService.js";
import { pushAfterSeuilSave } from "../hooks/confighPushHook.js";

/**
 * Small helpers for consistent logs/responses
 */
const CTRL = "[SeuilController]";
const THRESHOLD_SENSOR_TYPES = new Set([
  "temperature",
  "light",
  "humidity",
  "pressure",
  "smoke",
  "motion",
]);

const getThresholdSensors = (sensors = []) =>
  (Array.isArray(sensors) ? sensors : []).filter((sensor) =>
    THRESHOLD_SENSOR_TYPES.has(sensor)
  );

const logInfo = (message, extra = null) => {
  if (extra) console.log(`${CTRL} ${message}`, extra);
  else console.log(`${CTRL} ${message}`);
};

const logWarn = (message, extra = null) => {
  if (extra) console.warn(`${CTRL} ${message}`, extra);
  else console.warn(`${CTRL} ${message}`);
};

const logError = (message, extra = null) => {
  if (extra) console.error(`${CTRL} ${message}`, extra);
  else console.error(`${CTRL} ${message}`);
};

const sendError = (res, status, message, extra = {}) => {
  return res.status(status).json({
    success: false,
    message,
    ...extra,
  });
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Convert a plain object OR an existing Map to a proper ES6 Map so that
 * Mongoose's Map field type receives the correct type and the pre('validate')
 * hook can safely call .entries() on it.
 *
 * req.body is always a plain object after JSON.parse — assigning it directly
 * to a Mongoose Map field does NOT auto-convert, causing `.entries()` to throw
 * "next is not a function" inside the pre('validate') hook.
 */
const toMongooseMap = (value) => {
  if (!value) return new Map();
  if (value instanceof Map) return value;
  return new Map(Object.entries(value));
};

/**
 * Safe fire-and-forget wrapper for pushAfterSeuilSave.
 * Prevents any internal crash (e.g. "next is not a function") from
 * bubbling up and killing the HTTP response that has already been sent.
 */
const safePush = (equipmentId) => {
  try {
    const result = pushAfterSeuilSave(equipmentId);
    // Handle promise rejections too (if the hook is async)
    if (result && typeof result.catch === "function") {
      result.catch((err) =>
        logWarn("pushAfterSeuilSave async error (non-fatal)", {
          equipmentId,
          message: err.message,
        })
      );
    }
  } catch (err) {
    logWarn("pushAfterSeuilSave sync error (non-fatal)", {
      equipmentId,
      message: err.message,
    });
  }
};

/**
 * Normalize payload for manual update
 * Keeps only fields that are allowed to be manually updated.
 */
const buildManualUpdatePayload = (body = {}) => {
  const payload = {};

  if (body.floor !== undefined) payload.floor = body.floor;
  if (body.officeRoom !== undefined) payload.officeRoom = body.officeRoom;
  if (body.thresholds !== undefined) payload.thresholds = body.thresholds;

  if (body.meta && typeof body.meta === "object") {
    payload.meta = { ...body.meta };
  }

  return payload;
};

/**
 * GET /api/seuils
 * List all seuil profiles
 */
export const getAllSeuilProfiles = async (req, res) => {
  const startedAt = Date.now();

  try {
    const {
      equipmentId,
      nodeId,
      provider,
      usedSensorData,
      weatherAvailable,
      sensorType,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    logInfo("getAllSeuilProfiles called", { query: req.query });

    const filter = {};

    if (equipmentId) {
      if (!isValidObjectId(equipmentId)) {
        return sendError(res, 400, "Invalid equipmentId format");
      }
      filter.equipmentId = equipmentId;
    }

    if (nodeId) {
      filter.nodeId = String(nodeId).trim().toUpperCase();
    }

    if (provider) {
      filter["meta.provider"] = String(provider).trim();
    }

    if (usedSensorData !== undefined) {
      filter["meta.usedSensorData"] = String(usedSensorData) === "true";
    }

    if (weatherAvailable !== undefined) {
      filter["meta.weatherAvailable"] = String(weatherAvailable) === "true";
    }

    if (sensorType) {
      filter[`thresholds.${sensorType}`] = { $exists: true };
    }

    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const sortDirection = String(order).toLowerCase() === "asc" ? 1 : -1;
    const allowedSortFields = ["createdAt", "updatedAt", "nodeId"];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      Seuil.find(filter)
        .sort({ [safeSortBy]: sortDirection })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Seuil.countDocuments(filter),
    ]);

    logInfo("getAllSeuilProfiles success", {
      count: items.length,
      total,
      durationMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      success: true,
      message: "Seuil profiles fetched successfully",
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
      data: items,
    });
  } catch (error) {
    logError("getAllSeuilProfiles failed", {
      message: error.message,
      stack: error.stack,
    });

    return sendError(res, 500, "Failed to fetch seuil profiles", {
      error: error.message,
    });
  }
};

/**
 * GET /api/seuils/equipment/:equipmentId
 * Get one seuil profile by equipmentId
 */
export const getSeuilProfileByEquipmentId = async (req, res) => {
  const startedAt = Date.now();
  const { equipmentId } = req.params;

  try {
    logInfo("getSeuilProfileByEquipmentId called", { equipmentId });

    if (!isValidObjectId(equipmentId)) {
      return sendError(res, 400, "Invalid equipmentId format");
    }

    const seuil = await Seuil.findOne({ equipmentId }).lean();

    if (!seuil) {
      logWarn("Seuil profile not found", { equipmentId });
      return sendError(res, 404, "Seuil profile not found for this equipment");
    }

    logInfo("getSeuilProfileByEquipmentId success", {
      equipmentId,
      nodeId: seuil.nodeId,
      durationMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      success: true,
      message: "Seuil profile fetched successfully",
      data: seuil,
    });
  } catch (error) {
    logError("getSeuilProfileByEquipmentId failed", {
      equipmentId,
      message: error.message,
      stack: error.stack,
    });

    return sendError(res, 500, "Failed to fetch seuil profile", {
      error: error.message,
    });
  }
};

/**
 * POST /api/seuils/equipment/:equipmentId/regenerate
 * Re-generate threshold profile using BackM AI flow.
 */
export const regenerateSeuilProfile = async (req, res) => {
  const startedAt = Date.now();
  const { equipmentId } = req.params;

  try {
    logInfo("regenerateSeuilProfile called", { equipmentId });

    if (!isValidObjectId(equipmentId)) {
      return sendError(res, 400, "Invalid equipmentId format");
    }

    const equipment = await Equipment.findById(equipmentId).lean();

    if (!equipment) {
      logWarn("Equipment not found for regeneration", { equipmentId });
      return sendError(res, 404, "Equipment not found");
    }

    logInfo("Equipment found for regeneration", {
      equipmentId,
      nodeId: equipment.nodeId,
      floor: equipment.floor,
      officeRoom: equipment.officeRoom,
      sensors: equipment.sensors,
    });

    const thresholdSensors = getThresholdSensors(equipment.sensors);

    if (thresholdSensors.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Equipment has no sensors that require thresholds",
        data: null,
      });
    }

    const generatedProfile = await requestThresholdProfileFromBackM({
      ...equipment,
      sensors: thresholdSensors,
    });

    logInfo("Generated profile received from BackM", {
      equipmentId,
      nodeId: generatedProfile?.nodeId,
      thresholdKeys: generatedProfile?.thresholds
        ? Object.keys(generatedProfile.thresholds)
        : [],
      meta: generatedProfile?.meta,
    });

    const existingSeuil = await Seuil.findOne({ equipmentId: equipment._id }).lean();

    const rawThresholds = existingSeuil?.thresholds;
    const existingThresholds = !rawThresholds
      ? {}
      : rawThresholds instanceof Map
      ? Object.fromEntries(rawThresholds)
      : rawThresholds;

    const finalThresholds = Object.fromEntries(
      Object.entries(generatedProfile.thresholds || {}).filter(([sensorType]) =>
        thresholdSensors.includes(sensorType)
      )
    );

    for (const [sensorType, existingThreshold] of Object.entries(existingThresholds)) {
      if (
        existingThreshold?.mode === "user" &&
        finalThresholds[sensorType] !== undefined
      ) {
        finalThresholds[sensorType] = existingThreshold;
        logInfo(`Skipping sensor ${sensorType} — user-defined, AI cannot override`);
      }
    }

    const seuilPayload = {
      equipmentId: equipment._id,
      nodeId: generatedProfile.nodeId || equipment.nodeId,
      floor: generatedProfile.floor ?? equipment.floor ?? "",
      officeRoom: generatedProfile.officeRoom ?? equipment.officeRoom ?? "",
      thresholds: finalThresholds,
      meta: generatedProfile.meta || {},
    };

    logInfo("Saving regenerated seuil payload", seuilPayload);

    const seuil = await Seuil.findOneAndUpdate(
      { nodeId: seuilPayload.nodeId },
      { $set: seuilPayload },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    logInfo("regenerateSeuilProfile success", {
      equipmentId,
      seuilId: seuil._id,
      nodeId: seuil.nodeId,
      durationMs: Date.now() - startedAt,
    });

    // ✅ Fire-and-forget — crash inside hook won't affect the response
    safePush(equipment._id);

    return res.status(200).json({
      success: true,
      message: "Seuil profile regenerated successfully",
      data: seuil,
    });
  } catch (error) {
    logError("regenerateSeuilProfile failed", {
      equipmentId,
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
      errors: error.errors,
    });

    if (error.name === "ValidationError") {
      return sendError(res, 422, "Generated seuil profile failed validation", {
        error: error.message,
        details: error.errors,
      });
    }

    if (error.code === 11000) {
      return sendError(res, 409, "Duplicate key error while regenerating seuil profile", {
        keyPattern: error.keyPattern,
        keyValue: error.keyValue,
      });
    }

    return sendError(res, 500, "Failed to regenerate seuil profile", {
      error: error.message,
      errorName: error.name,
      errorCode: error.code || null,
    });
  }
};

/**
 * PUT /api/seuils/equipment/:equipmentId
 * Manual profile update
 */
export const updateSeuilProfile = async (req, res) => {
  const startedAt = Date.now();
  const { equipmentId } = req.params;

  try {
    logInfo("updateSeuilProfile called", {
      equipmentId,
      bodyKeys: Object.keys(req.body || {}),
    });

    if (!isValidObjectId(equipmentId)) {
      return sendError(res, 400, "Invalid equipmentId format");
    }

    const existing = await Seuil.findOne({ equipmentId });

    if (!existing) {
      logWarn("Seuil profile not found for update", { equipmentId });
      return sendError(res, 404, "Seuil profile not found for this equipment");
    }

    const payload = buildManualUpdatePayload(req.body);

    if (Object.keys(payload).length === 0) {
      return sendError(res, 400, "No valid fields provided for update");
    }

    if (payload.floor !== undefined) {
      existing.floor = payload.floor;
    }

    if (payload.officeRoom !== undefined) {
      existing.officeRoom = payload.officeRoom;
    }

    if (payload.thresholds !== undefined) {
      // payload.thresholds comes from req.body — always a plain object.
      // Mongoose Map fields require a real Map; assigning a plain object
      // skips the conversion and breaks .entries() in the pre('validate') hook.
      existing.thresholds = toMongooseMap(payload.thresholds);
    }

    if (payload.meta !== undefined) {
      existing.meta = {
        ...(existing.meta?.toObject ? existing.meta.toObject() : existing.meta),
        ...payload.meta,
      };
    }

    await existing.save();

    logInfo("updateSeuilProfile success", {
      equipmentId,
      nodeId: existing.nodeId,
      durationMs: Date.now() - startedAt,
    });

    // ✅ Fire-and-forget — crash inside hook won't affect the response
    safePush(equipmentId);

    return res.status(200).json({
      success: true,
      message: "Seuil profile updated successfully",
      data: existing,
    });
  } catch (error) {
    logError("updateSeuilProfile failed", {
      equipmentId,
      message: error.message,
      stack: error.stack,
    });

    if (error.name === "ValidationError") {
      return sendError(res, 422, "Seuil profile validation failed", {
        error: error.message,
      });
    }

    return sendError(res, 500, "Failed to update seuil profile", {
      error: error.message,
    });
  }
};

/**
 * PUT /api/seuils/sensor/:sensorType/global
 * Manually set the same threshold values for a given sensor type across ALL
 * equipment profiles that have it.
 */
export const globalUpdateSensorThreshold = async (req, res) => {
  const { sensorType } = req.params;
  const {
    min,
    max,
    threshold,
    hysteresis = 0,
    reason = "",
    description = "",
  } = req.body;

  try {
    logInfo("globalUpdateSensorThreshold called", { sensorType, body: req.body });

    const profiles = await Seuil.find({
      [`thresholds.${sensorType}`]: { $exists: true },
    }).lean();

    if (profiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No equipment profiles found with sensor: ${sensorType}`,
      });
    }

    const newThreshold = {
      min:         Number(min),
      max:         Number(max),
      threshold:   Number(threshold),
      hysteresis:  Number(hysteresis),
      reason:      reason || "",
      description: description || "",
      mode:        "user",
      confidence:  1,
    };

    const result = await Seuil.updateMany(
      {
        [`thresholds.${sensorType}`]: { $exists: true },
        [`thresholds.${sensorType}.mode`]: { $ne: "locked" },
      },
      {
        $set: { [`thresholds.${sensorType}`]: newThreshold },
      }
    );

    const updatedCount = result.modifiedCount;
    logInfo("globalUpdateSensorThreshold success", { sensorType, updatedCount });

    if (updatedCount > 0) {
      // ✅ Fire-and-forget for each profile
      profiles.forEach((profile) => safePush(profile.equipmentId));
    }

    return res.status(200).json({
      success: true,
      message: `Sensor "${sensorType}" updated in ${updatedCount} profile(s). Mode set to "user".`,
      data: { sensorType, updatedCount },
    });
  } catch (error) {
    logError("globalUpdateSensorThreshold failed", { message: error.message });
    return sendError(res, 500, "Failed to globally update sensor threshold", {
      error: error.message,
    });
  }
};

/**
 * POST /api/seuils/sensor/:sensorType/regenerate-all
 * Ask the AI to regenerate a given sensor type across ALL equipment that have it.
 */
export const globalRegenerateSensorThreshold = async (req, res) => {
  const { sensorType } = req.params;

  try {
    logInfo("globalRegenerateSensorThreshold called", { sensorType });
    const equipmentsWithSensor = await Equipment.find({
      sensors: sensorType,
    }).lean();

    if (equipmentsWithSensor.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No equipment found with sensor: ${sensorType}`,
      });
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const equipment of equipmentsWithSensor) {
      try {
        const existingSeuil = await Seuil.findOne({
          equipmentId: equipment._id,
        }).lean();

        const existingMode = existingSeuil?.thresholds?.[sensorType]?.mode;

        if (existingMode === "user") {
          logInfo(
            `Skipping ${equipment.nodeId} — sensor ${sensorType} is user-defined`
          );
          skippedCount++;
          continue;
        }

        const equipmentForAI = { ...equipment, sensors: [sensorType] };
        const generatedProfile =
          await requestThresholdProfileFromBackM(equipmentForAI);

        const existingThresholds = existingSeuil?.thresholds
          ? Object.fromEntries(Object.entries(existingSeuil.thresholds))
          : {};

        const mergedThresholds = {
          ...existingThresholds,
          [sensorType]: generatedProfile.thresholds[sensorType],
        };

        await Seuil.findOneAndUpdate(
          { nodeId: equipment.nodeId },
          {
            $set: {
              equipmentId: equipment._id,
              nodeId: equipment.nodeId,
              floor: equipment.floor || "",
              officeRoom: equipment.officeRoom || "",
              thresholds: mergedThresholds,
              meta: generatedProfile.meta || {},
            },
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          }
        );

        updatedCount++;
      } catch (err) {
        logError(
          `Failed to regenerate ${sensorType} for ${equipment.nodeId}`,
          { message: err.message }
        );
        errors.push({ nodeId: equipment.nodeId, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Global AI regeneration complete for sensor "${sensorType}".`,
      data: {
        sensorType,
        updatedCount,
        skippedCount,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    logError("globalRegenerateSensorThreshold failed", {
      message: error.message,
    });
    return sendError(res, 500, "Failed to globally regenerate sensor threshold", {
      error: error.message,
    });
  }
};