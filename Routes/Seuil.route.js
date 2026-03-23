import express from "express";

import {
  getAllSeuilProfiles,
  getSeuilProfileByEquipmentId,
  regenerateSeuilProfile,
  updateSeuilProfile,
} from "../Controllers/seuilController.js";

import {
  validate,
  getAllSeuilProfilesQueryRules,
  getSeuilProfileByEquipmentIdRules,
  regenerateSeuilProfileRules,
  updateSeuilProfileRules,
} from "../middleware/seuilValidator.js";

const router = express.Router();

/**
 * @route   GET /api/seuils
 * @desc    Get all seuil profiles with optional filters/pagination
 */
router.get(
  "/",
  getAllSeuilProfilesQueryRules,
  validate,
  getAllSeuilProfiles
);

/**
 * @route   GET /api/seuils/equipment/:equipmentId
 * @desc    Get one seuil profile by equipmentId
 */
router.get(
  "/equipment/:equipmentId",
  getSeuilProfileByEquipmentIdRules,
  validate,
  getSeuilProfileByEquipmentId
);

/**
 * @route   POST /api/seuils/equipment/:equipmentId/regenerate
 * @desc    Regenerate AI threshold profile for one equipment
 */
router.post(
  "/equipment/:equipmentId/regenerate",
  regenerateSeuilProfileRules,
  validate,
  regenerateSeuilProfile
);

/**
 * @route   PUT /api/seuils/equipment/:equipmentId
 * @desc    Manually update a seuil profile
 */
router.put(
  "/equipment/:equipmentId",
  updateSeuilProfileRules,
  validate,
  updateSeuilProfile
);

export default router;