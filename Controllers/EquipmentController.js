// controllers/equipmentController.js
import Equipment from '../models/Equipment.js';
import Seuil from "../models/Seuil.js";
import { requestThresholdProfileFromBackM } from "../services/AiService.js";

const formatValidationErrors = (err) => {
  const errors = {};
  Object.keys(err.errors || {}).forEach((field) => {
    errors[field] = err.errors[field].message;
  });
  return errors;
};

export const getEquipments = async (req, res) => {
  try {
    console.log("[Equipment] GET /api/equipment — fetching all");

    const equipments = await Equipment.find().sort({ createdAt: -1 });

    console.log(`[Equipment] Found ${equipments.length} equipment(s)`);

    return res.status(200).json({
      success: true,
      count: equipments.length,
      data: equipments,
    });
  } catch (err) {
    console.error("[Equipment] Error fetching:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching equipments",
      error: err.message,
    });
  }
};

export const createEquipment = async (req, res) => {
  try {
    const { name, nodeId, ipAddress, location, description, icon, sensors } = req.body;

    console.log("[Equipment] POST /api/equipment — payload:", {
      name,
      nodeId,
      ipAddress,
      location,
      icon,
      sensors: sensors?.length ?? 0,
    });

    const equipment = await Equipment.create({
      name: name.trim(),
      nodeId: nodeId.trim().toUpperCase(),
      ipAddress: ipAddress.trim(),
      location: location?.trim() ?? "",
      description: description?.trim() ?? "",
      icon: icon ?? "lighting",
      sensors: Array.isArray(sensors) ? sensors : [],
    });

    console.log(
      "[Equipment] Created:",
      equipment._id,
      "| name:",
      equipment.name,
      "| icon:",
      equipment.icon,
      "| sensors:",
      equipment.sensors.join(", ") || "none"
    );

    let seuilProfile = null;
    let warning = null;

    try {
      console.log("[Equipment] Calling BackM to generate thresholds...", {
        equipmentId: equipment._id,
        nodeId: equipment.nodeId,
      });

      const generatedProfile = await requestThresholdProfileFromBackM({
        _id: equipment._id,
        nodeId: equipment.nodeId,
        location: equipment.location,
        sensors: equipment.sensors,
      });

      console.log("[Equipment] BackM returned threshold profile:", {
        nodeId: generatedProfile?.nodeId,
        thresholdKeys: generatedProfile?.thresholds
          ? Object.keys(generatedProfile.thresholds)
          : [],
      });

      seuilProfile = await Seuil.findOneAndUpdate(
        { equipmentId: equipment._id },
        {
          equipmentId: equipment._id,
          nodeId: generatedProfile.nodeId || equipment.nodeId,
          location: generatedProfile.location ?? equipment.location ?? "",
          thresholds: generatedProfile.thresholds,
          meta: generatedProfile.meta || {},
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      console.log("[Equipment] Seuil profile saved successfully:", {
        seuilId: seuilProfile._id,
        equipmentId: equipment._id,
        nodeId: equipment.nodeId,
      });
    } catch (aiErr) {
      warning = `Equipment created, but seuil generation failed: ${aiErr.message}`;
      console.error("[Equipment] Threshold generation/save failed:", {
        message: aiErr.message,
        stack: aiErr.stack,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Equipment "${equipment.name}" created successfully`,
      data: {
        equipment,
        seuilProfile,
      },
      warning,
    });
  } catch (err) {
    console.error("[Equipment] Error creating:", err.message);

    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0];
      return res.status(409).json({
        success: false,
        message: `An equipment with this ${field} already exists`,
        field,
      });
    }

    if (err.name === "ValidationError") {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(err),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error while creating equipment",
      error: err.message,
    });
  }
};

export const updateEquipment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, nodeId, ipAddress, location, description, status, icon, sensors } = req.body;

    console.log(`[Equipment] PUT /api/equipment/${id} — payload:`, req.body);

    const updateFields = {};
    if (name !== undefined) updateFields.name = name.trim();
    if (nodeId !== undefined) updateFields.nodeId = nodeId.trim().toUpperCase();
    if (ipAddress !== undefined) updateFields.ipAddress = ipAddress.trim();
    if (location !== undefined) updateFields.location = location.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (status !== undefined) updateFields.status = status;
    if (icon !== undefined) updateFields.icon = icon;
    if (sensors !== undefined) updateFields.sensors = Array.isArray(sensors) ? sensors : [];

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided for update",
      });
    }

    const equipment = await Equipment.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!equipment) {
      console.warn(`[Equipment] Not found for update: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    console.log(
      "[Equipment] Updated:",
      equipment._id,
      "| name:",
      equipment.name,
      "| icon:",
      equipment.icon,
      "| sensors:",
      equipment.sensors.join(", ") || "none"
    );

    return res.status(200).json({
      success: true,
      message: `Equipment "${equipment.name}" updated successfully`,
      data: equipment,
    });
  } catch (err) {
    console.error("[Equipment] Error updating:", err.message);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format",
      });
    }

    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0];
      return res.status(409).json({
        success: false,
        message: `Duplicate ${field}`,
        field,
      });
    }

    if (err.name === "ValidationError") {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(err),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error while updating equipment",
      error: err.message,
    });
  }
};

export const deleteEquipment = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[Equipment] DELETE /api/equipment/${id}`);

    const equipment = await Equipment.findByIdAndDelete(id);

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    console.log("[Equipment] Deleted:", equipment._id, "| nodeId:", equipment.nodeId);

    return res.status(200).json({
      success: true,
      message: `Equipment "${equipment.name}" deleted successfully`,
    });
  } catch (err) {
    console.error("[Equipment] Error deleting:", err.message);

    if (err.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error while deleting equipment",
      error: err.message,
    });
  }
};