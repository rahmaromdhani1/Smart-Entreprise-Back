// Back App/controllers/reportsController.js
import EnergyPrice from '../models/EnergyPrice.js';

const BACKM_URL = process.env.BACKM_URL || 'http://localhost:5050';

async function fetchBackM(path) {
  const res = await fetch(`${BACKM_URL}${path}`);
  if (!res.ok) throw new Error(`BackM ${path} → ${res.status}`);
  return res.json();
}

// GET /api/reports?period=day|week|month
export const getReports = async (req, res) => {
  const period = req.query.period || 'week';
  try {
    const [energy, savings, operatingTime, alerts, priceDoc] = await Promise.all([
      fetchBackM(`/api/stats/energy?period=${period}`),
      fetchBackM('/api/stats/energy/savings'),
      fetchBackM(`/api/stats/operating-time?period=${period}`),
      fetchBackM(`/api/stats/alerts?period=${period}`),
      EnergyPrice.findOne().sort({ updatedAt: -1 }),
    ]);

    const pricePerKwh = priceDoc?.pricePerKwh ?? 0.2;
    const cost        = parseFloat((energy.total * pricePerKwh).toFixed(2));
    const savedCost   = parseFloat(((savings.savedKwh ?? 0) * pricePerKwh).toFixed(2));

    res.json({
      energy:        { ...energy, cost },
      savings:       { ...savings, savedCost },
      operatingTime,
      alerts,
      pricePerKwh,
    });
  } catch (err) {
    console.error('[Reports] getReports:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/reports/energy-history?hours=24
export const getEnergyHistory = async (req, res) => {
  const hours = req.query.hours || 24;
  try {
    const history = await fetchBackM(`/api/stats/energy/history?hours=${encodeURIComponent(hours)}`);
    res.json(history);
  } catch (err) {
    console.error('[Reports] getEnergyHistory:', err.message);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/reports/price
export const getPrice = async (req, res) => {
  try {
    const doc = await EnergyPrice.findOne().sort({ updatedAt: -1 });
    res.json({ pricePerKwh: doc?.pricePerKwh ?? 0.2 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/reports/price
export const updatePrice = async (req, res) => {
  const { pricePerKwh } = req.body;
  if (!pricePerKwh || isNaN(pricePerKwh))
    return res.status(400).json({ message: 'pricePerKwh must be a number' });
  try {
    const doc = await EnergyPrice.findOneAndUpdate(
      {},
      { pricePerKwh: parseFloat(pricePerKwh), updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ pricePerKwh: doc.pricePerKwh });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
