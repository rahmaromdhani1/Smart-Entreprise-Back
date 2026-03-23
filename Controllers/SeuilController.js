import mongoose from "mongoose";
import Seuil from "../models/Seuil.js";
import Equipment from "../models/Equipment.js";
import { requestThresholdProfileFromBackM } from "../services/AiService.js";

/**
 * Small helpers for consistent logs/responses
 */
const CTRL = "[SeuilController]";

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
 * Normalize payload for manual update
 * Keeps only fields that are allowed to be manually updated.
 */
const buildManualUpdatePayload = (body = {}) => {
  const payload = {};

  if (body.location !== undefined) payload.location = body.location;
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
      location,
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

    if (location) {
      filter.location = new RegExp(String(location).trim(), "i");
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
    const allowedSortFields = ["createdAt", "updatedAt", "nodeId", "location"];
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
 * Re-generate threshold profile using BackM AI flow
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
      location: equipment.location,
      sensors: equipment.sensors,
    });

    if (!Array.isArray(equipment.sensors) || equipment.sensors.length === 0) {
      return sendError(res, 422, "Equipment has no sensors configured");
    }

    const generatedProfile = await requestThresholdProfileFromBackM(equipment);

    logInfo("Generated profile received from BackM", {
      equipmentId,
      nodeId: generatedProfile?.nodeId,
      thresholdKeys: generatedProfile?.thresholds
        ? Object.keys(generatedProfile.thresholds)
        : [],
      meta: generatedProfile?.meta,
    });

    const seuilPayload = {
      equipmentId: equipment._id,
      nodeId: generatedProfile.nodeId || equipment.nodeId,
      location: generatedProfile.location ?? equipment.location ?? "",
      thresholds: generatedProfile.thresholds,
      meta: generatedProfile.meta || {},
    };

    logInfo("Saving regenerated seuil payload", seuilPayload);

    const seuil = await Seuil.findOneAndUpdate(
      { equipmentId: equipment._id },
      seuilPayload,
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

    if (payload.location !== undefined) {
      existing.location = payload.location;
    }

    if (payload.thresholds !== undefined) {
      existing.thresholds = payload.thresholds;
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