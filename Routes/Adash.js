import express from 'express';
const router = express.Router();

router.get('/dashboard', (req, res) => {
  const stats = {
    energy: { value: Math.floor(Math.random() * 5000), unit: 'kWh', change: Math.floor(Math.random() * 20) - 10, trend: Math.random() > 0.5 ? 'up' : 'down' },
    temperature: { value: (Math.random() * 40).toFixed(1), unit: '°C', status: 'Optimal' },
    activeStations: { current: Math.floor(Math.random() * 32), total: 32, percentage: Math.floor(Math.random() * 100) },
    alerts: { count: Math.floor(Math.random() * 10), change: Math.floor(Math.random() * 5), trend: Math.random() > 0.5 ? 'up' : 'down' }
  };
  
  const iotDistribution = {
    lights: Math.floor(Math.random() * 50),
    ac: Math.floor(Math.random() * 40),
    others: Math.floor(Math.random() * 20),
    total: 32,
  };

  const chartData = Array.from({ length: 7 }, () => ({ percentage: Math.floor(Math.random() * 100) }));

  res.json({ stats, iotDistribution, chartData });
});

export default router;
