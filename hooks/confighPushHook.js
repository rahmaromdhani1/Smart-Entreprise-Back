import mqtt from "mqtt";
import Equipment from "../models/Equipment.js";
import Seuil from "../models/Seuil.js";

const LOG = "[Back][ConfigPushHook]";

let mqttClient = null;

const brokerUrl = () => {
  if (process.env.MQTT_BROKER_URL) {
    return process.env.MQTT_BROKER_URL;
  }

  const host = process.env.MQTT_BROKER_HOST || "localhost";
  const port = process.env.MQTT_BROKER_PORT || "1883";
  return `mqtt://${host}:${port}`;
};

const getMqttClient = () => {
  if (mqttClient) {
    return mqttClient;
  }

  mqttClient = mqtt.connect(brokerUrl(), {
    clientId: process.env.MQTT_BACKEND_CLIENT_ID || `backend-config-push-${process.pid}`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 2000,
  });

  mqttClient.on("connect", () => {
    console.log(`${LOG} Connected to MQTT broker ${brokerUrl()}`);
  });

  mqttClient.on("error", (err) => {
    console.error(`${LOG} MQTT error:`, err.message);
  });

  mqttClient.on("reconnect", () => {
    console.log(`${LOG} Reconnecting to MQTT broker...`);
  });

  return mqttClient;
};

const asId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  return String(value);
};

const normalizeThresholds = (thresholds) => {
  if (!thresholds) return {};
  if (thresholds instanceof Map) return Object.fromEntries(thresholds);
  if (typeof thresholds.toObject === "function") return thresholds.toObject();
  return thresholds;
};

const buildPayload = (equipment, seuil) => ({
  equipmentId: String(equipment._id || equipment.id),
  nodeId: equipment.nodeId,
  mac: (equipment.mac || "").toUpperCase(),
  floor: equipment.floor || "",
  officeRoom: equipment.officeRoom || "",
  sensors: Array.isArray(equipment.sensors) ? equipment.sensors : [],
  actuators: Array.isArray(equipment.actuators) ? equipment.actuators : [],
  thresholds: normalizeThresholds(seuil?.thresholds),
});

const publishPayload = (equipment, seuil) => {
  if (!equipment?.mac) {
    console.warn(`${LOG} Skipping - equipment "${equipment?.nodeId}" has no mac yet.`);
    return Promise.resolve();
  }

  const topic = `system/${equipment.mac.toUpperCase()}/equipment`;
  const payload = buildPayload(equipment, seuil);
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    getMqttClient().publish(topic, body, { qos: 1, retain: false }, (err) => {
      if (err) {
        console.error(`${LOG} Publish failed for ${topic}:`, err.message);
      } else {
        console.log(
          `${LOG} Published ${topic} - sensors: ${payload.sensors.join(", ") || "none"} | actuators: ${payload.actuators.map(a => a.type || a).join(", ") || "none"}`
        );
      }

      resolve();
    });
  });
};

const publishByEquipmentId = async (equipmentId) => {
  if (!equipmentId) {
    console.warn(`${LOG} Missing equipmentId, skipping config publish`);
    return;
  }

  const equipment = await Equipment.findById(equipmentId).lean();
  if (!equipment) {
    console.warn(`${LOG} Equipment not found for config publish: ${equipmentId}`);
    return;
  }

  const seuil = await Seuil.findOne({ equipmentId: equipment._id }).lean();
  await publishPayload(equipment, seuil);
};

const publishByNodeId = async (nodeId) => {
  if (!nodeId) {
    console.warn(`${LOG} Missing nodeId, skipping config publish`);
    return;
  }

  const normalizedNodeId = String(nodeId).trim().toUpperCase();
  const equipment = await Equipment.findOne({ nodeId: normalizedNodeId }).lean();
  if (!equipment) {
    console.warn(`${LOG} Equipment not found for nodeId: ${normalizedNodeId}`);
    return;
  }

  const seuil = await Seuil.findOne({ equipmentId: equipment._id }).lean();
  await publishPayload(equipment, seuil);
};

const runNonBlocking = (label, task) => {
  Promise.resolve()
    .then(task)
    .catch((err) => {
      console.error(`${LOG} ${label} failed:`, err.message);
    });
};

export const pushAfterEquipmentSave = (equipment) => {
  runNonBlocking("pushAfterEquipmentSave", () => publishByEquipmentId(asId(equipment)));
};

export const pushAfterSeuilSave = (equipmentId) => {
  runNonBlocking("pushAfterSeuilSave", () => publishByEquipmentId(asId(equipmentId)));
};

export const pushAfterMonitorCycle = (nodeId) => {
  runNonBlocking("pushAfterMonitorCycle", () => publishByNodeId(nodeId));
};

export async function pushAfterEquipmentDelete(mac, nodeId) {
  if (!mac) {
    console.warn('[ConfigPushHook] Delete skipped — no mac provided');
    return;
  }

  const client = getMqttClient();
  const topic  = `system/${mac.toUpperCase()}/delete`;
  const payload = JSON.stringify({ mac: mac.toUpperCase(), nodeId });

  client.publish(topic, payload, { qos: 1, retain: false }, (err) => {
    if (err) {
      console.error(`[ConfigPushHook] Delete publish failed for ${mac}:`, err.message);
    } else {
      console.log(`[ConfigPushHook] Published ${topic}`);
    }
  });
}