import express from 'express';
const router = express.Router();

// Route pour récupérer les données des reports
router.get('/reports', (req, res) => {
  // Simuler les stats
  const stats = [
    {
      title: 'Savings Achieved',
      value: `€${Math.floor(Math.random() * 5000)}`, // valeur aléatoire
      change: `${Math.floor(Math.random() * 20) - 10}%`, // variation -10 à +10
      changeText: 'this quarter',
      icon: 'savings',
      iconBg: 'rgba(16, 185, 129, 0.1)',
      iconColor: '#10B981',
    },
    {
      title: 'Operating Time',
      value: `${(Math.random() * 100).toFixed(1)}%`,
      change: 'Uptime',
      changeText: '',
      icon: 'time',
      iconBg: 'rgba(139, 92, 246, 0.1)',
      iconColor: '#8B5CF6',
    },
    {
      title: 'Alerts Resolved',
      value: Math.floor(Math.random() * 200),
      change: 'this month',
      changeText: '',
      icon: 'alerts',
      iconBg: 'rgba(245, 158, 11, 0.1)',
      iconColor: '#F59E0B',
    }
  ];

  // Simuler les données du graphique (Monthly Energy Consumption)
  const chartData = Array.from({ length: 6 }, () => Math.floor(Math.random() * 100));

  res.json({ stats, chartData });
});

export default router;
