// Backend/Routes/equipment.routes.js
import express from 'express';
import {
  getEquipments,
  createEquipment,
  updateEquipment,
  deleteEquipment,
} from '../Controllers/EquipmentController.js';

import { validate } from '../middleware/seuilValidator.js';
import {
  createEquipmentRules,
  updateEquipmentRules,
  equipmentIdParam,
} from '../middleware/equipmentValidator.js';

const router = express.Router();

router.route('/')
  .get(getEquipments)
  .post(createEquipmentRules, validate, createEquipment);

router.route('/:id')
  .put(equipmentIdParam, updateEquipmentRules, validate, updateEquipment)
  .delete(equipmentIdParam, validate, deleteEquipment);

export default router;