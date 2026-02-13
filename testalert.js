import mongoose from 'mongoose';
import Alert from './models/Alert.js';

// 1️⃣ Connecte-toi à MongoDB
const uri = "mongodb+srv://sems_users:Z5tRCHJ3RRNm6DCR@sems.vxe1dam.mongodb.net/SEMS?appName=SEMS";

mongoose.connect(uri)
  .then(() => console.log("MongoDB Atlas connecté ✅"))
  .catch(err => console.error("Erreur de connexion MongoDB Atlas:", err));
// 2️⃣ Crée et sauvegarde une alerte
async function createAlert() {
  const newAlert = new Alert({
    deviceId: 'device123',
    type: 'Electricity',
    level: 'critical',
    message: 'variable',
  });

  await newAlert.save();
  console.log('Alert saved:', newAlert);
  mongoose.disconnect(); // ferme la connexion
}

createAlert();
