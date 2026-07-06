// BackApp/Controllers/equipmentController.js (INTEGRATED WITH FIXES)
import Equipment from "../models/Equipment.js";
import Seuil from "../models/Seuil.js";
import { requestThresholdProfileFromBackM } from "../services/AiService.js";
import { pushAfterEquipmentSave, pushAfterEquipmentDelete } from "../hooks/confighPushHook.js";

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

const formatValidationErrors = (err) => {
  const errors = {};
  Object.keys(err.errors || {}).forEach((field) => {
    errors[field] = err.errors[field].message;
  });
  return errors;
};

export const getFloors = async (req, res) => {
  try {
    const floors = await Equipment.distinct('floor', { floor: { $ne: '' } });
    return res.status(200).json({ success: true, data: floors.filter(Boolean) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

export const getofficeRooms = async (req, res) => {
  try {
    const officeRooms = await Equipment.distinct('officeRoom', { officeRoom: { $ne: '' } });
    return res.status(200).json({ success: true, data: officeRooms.filter(Boolean) });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// ✅ FIX: Expose status and isOnline in GET response
export const getEquipments = async (req, res) => {
  try {
    console.log("[Equipment] GET /api/equipment — fetching all");

    const equipments = await Equipment.find().sort({ createdAt: -1 });

    console.log(`[Equipment] Found ${equipments.length} equipment(s)`);

    // ✅ FIX: Ensure status and isOnline are exposed with every response
    const enrichedEquipments = equipments.map((eq) => ({
      ...eq.toObject(),
      isOnline: eq.isOnline || false,
      status: eq.status || 'unknown',
      lastHeartbeat: eq.lastHeartbeat || null,
    }));

    return res.status(200).json({
      success: true,
      count: equipments.length,
      data: enrichedEquipments,
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

// ✅ FIX: New endpoint to get equipment by ID with full status
export const getEquipmentById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[Equipment] GET /api/equipment/${id}`);

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...equipment.toObject(),
        isOnline: equipment.isOnline || false,
        status: equipment.status || 'unknown',
        lastHeartbeat: equipment.lastHeartbeat || null,
      },
    });
  } catch (err) {
    console.error("[Equipment] Error fetching by ID:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching equipment",
      error: err.message,
    });
  }
};

// ✅ FIX: New endpoint to get only status info (lightweight)
export const getEquipmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[Equipment] GET /api/equipment/${id}/status`);

    const equipment = await Equipment.findById(id).lean();
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: equipment._id,
        mac: equipment.mac,
        name: equipment.name,
        isOnline: equipment.isOnline || false,
        status: equipment.status || 'unknown',
        lastHeartbeat: equipment.lastHeartbeat || null,
        updatedAt: equipment.updatedAt,
      },
    });
  } catch (err) {
    console.error("[Equipment] Error fetching status:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching equipment status",
      error: err.message,
    });
  }
};

export const createEquipment = async (req, res) => {
  try {
    const { name, nodeId, ipAddress, floor, officeRoom, description, icon, sensors, mac, actuators } = req.body;

    console.log("[Equipment] POST /api/equipment — payload:", {
      name,
      nodeId,
      ipAddress,
      floor,
      officeRoom,
      icon,
      sensors: sensors?.length ?? 0,
      actuators: actuators?.length ?? 0,
    });

    const equipment = await Equipment.create({
      name: name.trim(),
      nodeId: nodeId.trim().toUpperCase(),
      mac: (mac || "").toUpperCase().trim(),
      ipAddress: ipAddress?.trim() ?? "",
      floor: floor?.trim() ?? "",
      officeRoom: officeRoom?.trim() ?? "",
      description: description?.trim() ?? "",
      icon: icon ?? "lighting",
      sensors: Array.isArray(sensors) ? sensors : [],
      actuators: Array.isArray(actuators) ? actuators : [],
      // ✅ FIX: Initialize status
      status: 'unknown',
      isOnline: false,
    });

    console.log(
      "[Equipment] Created:",
      equipment._id,
      "| name:",
      equipment.name,
      "| floor:",
      equipment.floor,
      "| officeRoom:",
      equipment.officeRoom,
      "| icon:",
      equipment.icon,
      "| sensors:",
      equipment.sensors.join(", ") || "none"
    );

    let seuilProfile = null;
    let warning = null;
    const thresholdSensors = getThresholdSensors(equipment.sensors);

    if (thresholdSensors.length === 0) {
      console.log("[Equipment] No threshold-required sensors, skipping seuil generation", {
        equipmentId: equipment._id,
        nodeId: equipment.nodeId,
        sensors: equipment.sensors,
      });
    } else {
      try {
        console.log("[Equipment] Calling BackM to generate thresholds...", {
          equipmentId: equipment._id,
          nodeId: equipment.nodeId,
          sensors: thresholdSensors,
        });

        const generatedProfile = await requestThresholdProfileFromBackM({
          _id: equipment._id,
          nodeId: equipment.nodeId,
          floor: equipment.floor,
          officeRoom: equipment.officeRoom,
          sensors: thresholdSensors,
        });

        const thresholds = Object.fromEntries(
          Object.entries(generatedProfile.thresholds || {}).filter(([sensorType]) =>
            thresholdSensors.includes(sensorType)
          )
        );

        console.log("[Equipment] BackM returned threshold profile:", {
          nodeId: generatedProfile?.nodeId,
          thresholdKeys: Object.keys(thresholds),
        });

        seuilProfile = await Seuil.findOneAndUpdate(
          { nodeId: generatedProfile.nodeId || equipment.nodeId },
          {
            $set: {
              equipmentId: equipment._id,
              nodeId: generatedProfile.nodeId || equipment.nodeId,
              floor: generatedProfile.floor ?? equipment.floor ?? "",
              officeRoom: generatedProfile.officeRoom ?? equipment.officeRoom ?? "",
              thresholds,
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
    }

    pushAfterEquipmentSave(equipment);

    return res.status(201).json({
      success: true,
      message: `Equipment "${equipment.name}" created successfully`,
      data: {
        equipment: {
          ...equipment.toObject(),
          isOnline: equipment.isOnline || false,
          status: equipment.status || 'unknown',
        },
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
    const { name, nodeId, ipAddress, floor, officeRoom, description, status, icon, sensors, mac, actuators } = req.body;

    console.log(`[Equipment] PUT /api/equipment/${id} — payload:`, req.body);

    const updateFields = {};
    if (name !== undefined) updateFields.name = name.trim();
    if (nodeId !== undefined) updateFields.nodeId = nodeId.trim().toUpperCase();
    if (mac !== undefined) updateFields.mac = mac.toUpperCase().trim();
    if (ipAddress !== undefined) updateFields.ipAddress = ipAddress.trim();
    if (floor !== undefined) updateFields.floor = floor.trim();
    if (officeRoom !== undefined) updateFields.officeRoom = officeRoom.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (status !== undefined) updateFields.status = status;
    if (icon !== undefined) updateFields.icon = icon;
    if (sensors !== undefined) updateFields.sensors = Array.isArray(sensors) ? sensors : [];
    if (actuators !== undefined) updateFields.actuators = Array.isArray(actuators) ? actuators : [];

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
      "| floor:",
      equipment.floor,
      "| officeRoom:",
      equipment.officeRoom,
      "| icon:",
      equipment.icon,
      "| sensors:",
      equipment.sensors.join(", ") || "none"
    );

    pushAfterEquipmentSave(equipment);

    return res.status(200).json({
      success: true,
      message: `Equipment "${equipment.name}" updated successfully`,
      data: {
        ...equipment.toObject(),
        isOnline: equipment.isOnline || false,
        status: equipment.status || 'unknown',
      },
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

    // Delete associated seuil profile (match on nodeId — consistent with upsert key)
    const seuilDeleteResult = await Seuil.deleteOne({ nodeId: equipment.nodeId });
    if (seuilDeleteResult.deletedCount > 0) {
      console.log(`[Equipment] Seuil profile deleted for nodeId: ${equipment.nodeId}`);
    } else {
      console.warn(`[Equipment] No seuil profile found to delete for nodeId: ${equipment.nodeId}`);
    }

    // Notify the physical card (non-blocking — must not fail the HTTP response)
    const mac    = equipment.mac;
    const nodeId = equipment.nodeId;

    if (mac) {
      pushAfterEquipmentDelete(mac, nodeId).catch(err =>
        console.error('[Equipment] Delete hook failed:', err.message)
      );
      console.log(`[Equipment] Delete notification sent for mac:${mac}`);
    } else {
      console.warn('[Equipment] Deleted equipment had no mac — card not notified');
    }

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

// ✅ FIX: New endpoint to update status manually (for admin/sync)
export const setEquipmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isOnline } = req.body;

    if (typeof isOnline !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isOnline must be a boolean',
      });
    }

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found',
      });
    }

    await equipment.setOnline(isOnline);

    console.log(`[Equipment] Status updated for ${equipment.mac}: ${equipment.status}`);

    return res.status(200).json({
      success: true,
      message: `Equipment status updated to ${equipment.status}`,
      data: {
        mac: equipment.mac,
        isOnline: equipment.isOnline,
        status: equipment.status,
        lastHeartbeat: equipment.lastHeartbeat,
      },
    });
  } catch (err) {
    console.error("[Equipment] Error setting status:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error while updating status",
      error: err.message,
    });
  }
};

// ✅ FIX: New endpoint to update actuator value
export const updateActuatorValue = async (req, res) => {
  try {
    const { id } = req.params;
    const { actuatorType, value } = req.body;

    if (!actuatorType) {
      return res.status(400).json({
        success: false,
        message: 'actuatorType is required',
      });
    }

    const equipment = await Equipment.findById(id);
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found',
      });
    }

    await equipment.updateActuator(actuatorType, value);

    console.log(`[Equipment] Actuator updated: ${equipment.mac}/${actuatorType} = ${JSON.stringify(value)}`);

    return res.status(200).json({
      success: true,
      message: `Actuator ${actuatorType} updated`,
      data: equipment,
    });
  } catch (err) {
    console.error("[Equipment] Error updating actuator:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error while updating actuator",
      error: err.message,
    });
  }
};

export const getEquipmentByMac = async (req, res) => {
  const mac = req.params.mac.trim().toUpperCase();
  const equipment = await Equipment.findOne({ mac }).lean();
  if (!equipment) return res.status(404).json({ success: false, error: "Not found" });
  return res.json({
    success: true,
    data: {
      ...equipment,
      isOnline: equipment.isOnline || false,
      status: equipment.status || 'unknown',
    },
  });
};

export const getEquipmentByNodeId = async (req, res) => {
  const nodeId = req.params.nodeId.trim().toUpperCase();
  const equipment = await Equipment.findOne({ nodeId }).lean();
  if (!equipment) return res.status(404).json({ success: false, error: "Not found" });
  return res.json({
    success: true,
    data: {
      ...equipment,
      isOnline: equipment.isOnline || false,
      status: equipment.status || 'unknown',
    },
  });
};

export const syncEquipmentStatus = async (req, res) => {
  try {
    const timeoutMs = Number(process.env.DEVICE_OFFLINE_TIMEOUT_MS || 30000);
    const staleBefore = new Date(Date.now() - timeoutMs);

    const staleResult = await Equipment.updateMany(
      {
        isOnline: true,
        $or: [
          { lastHeartbeat: { $exists: false } },
          { lastHeartbeat: null },
          { lastHeartbeat: { $lt: staleBefore } },
        ],
      },
      {
        $set: {
          isOnline: false,
          status: 'offline',
        },
      }
    );

    const equipments = await Equipment.find().sort({ createdAt: -1 }).lean();
    const online = equipments.filter((eq) => eq.isOnline === true).length;
    const offline = equipments.length - online;

    return res.json({
      success: true,
      message: 'Equipment status synced from MongoDB',
      data: {
        total: equipments.length,
        online,
        offline,
        staleUpdated: staleResult.modifiedCount || 0,
        equipments,
      },
    });
  } catch (err) {
    console.error('[Equipment] Error syncing status:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error while syncing equipment status',
      error: err.message,
    });
  }
};
