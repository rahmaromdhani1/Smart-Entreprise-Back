
import Seuil from "../models/Seuil.js";
import Equipment from "../models/Equipment.js";
import { requestThresholdProfileFromBackM } from "./AiService.js";
import { pushAfterMonitorCycle } from '../hooks/confighPushHook.js';

const MONITOR_INTERVAL_MS = 2 * 60 * 60 * 1000; // toutes les 2 heures

const LOG = "[ThresholdMonitor]";
const THRESHOLD_SENSOR_TYPES = new Set(["temperature", "light", "humidity", "pressure", "smoke", "motion"]);
const getThresholdSensors = (sensors = []) =>
  (Array.isArray(sensors) ? sensors : []).filter((sensor) => THRESHOLD_SENSOR_TYPES.has(sensor));

/**
 * Exécute un cycle de mise à jour pour tous les sensors mode="ai".
 * Ne touche jamais les sensors en mode="user" ou "locked".
 */
async function runMonitorCycle() {
  console.log(`${LOG} Starting monitor cycle at ${new Date().toISOString()}`);

  try {
    // Récupérer tous les profils Seuil
    const profiles = await Seuil.find({}).lean();
    console.log(`${LOG} Found ${profiles.length} seuil profile(s) to check`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const profile of profiles) {
      try {
        const equipment = await Equipment.findById(profile.equipmentId).lean();
        if (!equipment) {
          console.warn(
            `${LOG} Equipment not found for seuil ${profile._id}, skipping`
          );
          continue;
        }

        // Identifier les sensors qui peuvent être mis à jour par l'IA
        // (mode="ai" ou absent — jamais mode="user" ou "locked")
        const thresholdsMap = profile.thresholds || {};
        const aiSensors = getThresholdSensors(equipment.sensors).filter((sensorType) => {
          const existing = thresholdsMap[sensorType];
          return !existing || existing.mode === "ai";
        });

        if (aiSensors.length === 0) {
          skippedCount++;
          continue;
        }

        // Demander à l'IA de régénérer uniquement les sensors autorisés
        const equipmentForAI = { ...equipment, sensors: aiSensors };
        const generatedProfile =
          await requestThresholdProfileFromBackM(equipmentForAI);

        // Fusionner : garder les sensors user-mode, remplacer les ai-mode
        const finalThresholds = { ...thresholdsMap };
        for (const [sensorType, newThreshold] of Object.entries(
          generatedProfile.thresholds
        )) {
          const currentMode = thresholdsMap[sensorType]?.mode;
          if (currentMode !== "user" && currentMode !== "locked") {
            finalThresholds[sensorType] = newThreshold;
          }
        }

        await Seuil.findOneAndUpdate(
          { equipmentId: equipment._id },
          { thresholds: finalThresholds, meta: generatedProfile.meta },
          { new: true, runValidators: true }
        );
        pushAfterMonitorCycle(equipment.nodeId);
        updatedCount++;
        console.log(
          `${LOG} Updated ${equipment.nodeId} (sensors: ${aiSensors.join(", ")})`
        );
      } catch (err) {
        console.error(
          `${LOG} Error processing profile ${profile._id}:`,
          err.message
        );
      }
    }

    console.log(
      `${LOG} Cycle complete — updated: ${updatedCount}, skipped: ${skippedCount}`
    );
  } catch (err) {
    console.error(`${LOG} Monitor cycle failed:`, err.message);
  }
}

/**
 * Démarre le service de monitoring.
 * À appeler une fois dans server.js après la connexion MongoDB.
 */
export function startThresholdMonitor() {
  console.log(
    `${LOG} Monitor started. Interval: ${
      MONITOR_INTERVAL_MS / 1000 / 60
    } minutes`
  );

  // Premier cycle après 5 minutes (laisse le serveur démarrer)
  setTimeout(() => {
    runMonitorCycle();
    setInterval(runMonitorCycle, MONITOR_INTERVAL_MS);
  }, 5 * 60 * 1000);
}