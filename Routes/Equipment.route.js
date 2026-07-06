// BackApp/Routes/equipment.routes.js
import express from 'express';
import {
  getEquipments,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getFloors,
  getofficeRooms,
  getEquipmentByMac,
  getEquipmentByNodeId,
} from '../Controllers/equipmentController.js';
import mongoose from 'mongoose';
import { validate } from '../middleware/seuilValidator.js';
import {
  createEquipmentRules,
  updateEquipmentRules,
  equipmentIdParam,
} from '../middleware/equipmentValidator.js';

const router = express.Router();

/**
 * Equipment Routes
 * Mounted at /api/equipment in server.js
 *
 * GET    /api/equipment              → list all
 * GET    /api/equipment/statuses     → all device statuses (from devicestatuses collection)
 * GET    /api/equipment/floors       → distinct floors
 * GET    /api/equipment/officeRooms  → distinct office rooms
 * GET    /api/equipment/mac/:mac     → find by MAC address
 * GET    /api/equipment/node/:nodeId → find by node ID
 * GET    /api/equipment/:id          → get single equipment
 * POST   /api/equipment              → create (validated)
 * PUT    /api/equipment/:id          → update (validated)
 * DELETE /api/equipment/:id          → delete
 */

// ── Main CRUD ─────────────────────────────────────────────────────────────────
router.route('/')
  .get(getEquipments)
  .post(createEquipmentRules, validate, createEquipment);

// ── Distinct value helpers ────────────────────────────────────────────────────
// Must be declared before /:id to avoid param clash
router.get('/floors', getFloors);
router.get('/officeRooms', getofficeRooms);
router.get('/mac/:mac', getEquipmentByMac);
router.get('/node/:nodeId', getEquipmentByNodeId);

// ── Device statuses (source of truth: devicestatuses collection) ──────────────
const DeviceStatus = mongoose.models.devicestatuses ||
  mongoose.model('Device Status', new mongoose.Schema({
    mac:      { type: String, uppercase: true },
    nodeId:   { type: String },
    online:   { type: Boolean, default: false },
    lastSeen: { type: Date },
  }, { strict: false }));

router.get('/statuses', async (req, res) => {
  try {
    const statuses = await DeviceStatus.find({}, { mac: 1, nodeId: 1, online: 1, _id: 0 });
    const map = {};
    statuses.forEach(d => {
      if (d.mac)    map[d.mac.toUpperCase()]    = d.online;
      if (d.nodeId) map[d.nodeId.toUpperCase()] = d.online;
    });
    res.json(map);
  } catch (err) {
    console.error('[statuses] error:', err);
    res.status(500).json({ error: 'Failed to fetch statuses' });
  }
});

// ── Single equipment by ID ────────────────────────────────────────────────────
router.route('/:id')
  .get(getEquipmentById)
  .put(equipmentIdParam, updateEquipmentRules, validate, updateEquipment)
  .delete(equipmentIdParam, validate, deleteEquipment);

export default router;