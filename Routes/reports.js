
import express from 'express';
import { getReports, getEnergyHistory, getPrice, updatePrice } from '../controllers/reportsController.js';

const router = express.Router();

router.get('/reports',        getReports);
router.get('/reports/energy-history', getEnergyHistory);
router.get('/reports/price',  getPrice);
router.put('/reports/price',  updatePrice);

export default router;
