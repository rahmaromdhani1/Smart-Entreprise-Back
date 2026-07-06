import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import http from "http";
import jwt from "jsonwebtoken";
import authRoutes from "./Routes/auth.js";
import userRoutes from "./Routes/users.js";
import dashboardRoutes from "./Routes/Adash.js";
import PdashboardRoutes from "./Routes/Pdash.js";
import path from "path";
import { fileURLToPath } from "url";
import alertRoutes from "./Routes/alerte.route.js";
import reportsRoutes from "./Routes/reports.js";
import adminUsersRoutes from "./Routes/Adminusers.js";
import seuilRoutes from "./Routes/Seuil.route.js";
import EquipmentRoutes from "./Routes/Equipment.route.js";
import { startThresholdMonitor } from "./services/thresholdMonitorService.js";
import { sensorStore } from "./sensorStore.js";
import { initBridge } from "./services/sensorBridgeService.js";
import Equipment from './models/Equipment.js';
import User from "./models/User.js";
import {
  registerActuatorHandlers,
  registerBackMListeners,
} from "./services/actuatorSocketHandler.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE DES ACTUATORS
//
// Structure :
//   Map< MAC_UPPER, Map< actuatorType, {
//     value, roomId, floor, room,
//     on, brightness, color,   ← LED uniquement
//     source,                  ← NOUVEAU : 'app'|'switch'|'system'|null
//   }>>
//
// Le champ "source" est persisté en cache et en DB (actuators.$.lastSource)
// pour que l'UI puisse afficher le bon indicateur au rechargement de page.
// ═══════════════════════════════════════════════════════════════════════════════
const actuatorStateCache = new Map();

const devicePresenceRegistry = new Map();
const USER_TIMEOUT = 60 * 1000;
const userTimers   = new Map();

/**
 * Met à jour le cache en mémoire et persiste en DB.
 * Le paramètre `extra` accepte : { on, brightness, color, source }
 * Ces champs sont spécifiques à led_strip mais inoffensifs pour les autres.
 */
function _cacheActuatorState(mac, actuatorType, value, roomId, floor, room, extra = {}) {
  const key = (mac || "").toUpperCase();

  if (!actuatorStateCache.has(key)) {
    actuatorStateCache.set(key, new Map());
  }

  const macMap   = actuatorStateCache.get(key);
  const previous = macMap.get(actuatorType) ?? {};

  const entry = {
    value:      value      !== undefined ? value      : previous.value,
    roomId:     roomId     ?? previous.roomId     ?? null,
    floor:      floor      ?? previous.floor      ?? null,
    room:       room       ?? previous.room       ?? null,
    // Champs LED enrichis — null pour les autres actuateurs
    on:         extra.on         !== undefined ? extra.on         : previous.on         ?? null,
    brightness: extra.brightness !== undefined ? extra.brightness : previous.brightness ?? null,
    color:      extra.color      !== undefined ? extra.color      : previous.color      ?? null,
    // source : qui contrôle la LED en ce moment
    //   "app"    → admin/chef via interface
    //   "switch" → interrupteur physique ESP32 (GPIO4)
    //   "system" → automation BackM (seuil capteur, météo…)
    //   null     → non renseigné (ancien firmware)
    source:     extra.source     !== undefined ? extra.source     : previous.source     ?? null,
  };

  macMap.set(actuatorType, entry);

  // Persister en DB — on stocke aussi lastSource pour récupérer l'état au redémarrage
  const dbUpdate = {
    'actuators.$.lastValue':  value,
    'actuators.$.lastUpdate': new Date(),
  };
  if (actuatorType === 'led_strip' && extra.source !== undefined) {
    dbUpdate['actuators.$.lastSource'] = extra.source;
  }

  Equipment.findOneAndUpdate(
    { mac: key, 'actuators.type': actuatorType },
    { $set: dbUpdate },
    { new: true }
  ).catch(err => console.error('[BackApp] ❌ cache persist error:', err));

  console.log(
    `[BackApp] cache → ${key}/${actuatorType}` +
    ` = ${JSON.stringify(entry.value)}` +
    (entry.source ? ` source=${entry.source}` : '') +
    ` | roomId=${entry.roomId} floor=${entry.floor} room=${entry.room}`
  );
}

function markUserOnline(userId) {
  User.findByIdAndUpdate(userId, {
    isOnline: true,
    lastSeen: new Date(),
  }).catch(() => {});

  if (userTimers.has(userId)) {
    clearTimeout(userTimers.get(userId));
  }

  userTimers.set(
    userId,
    setTimeout(() => {
      User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      }).catch(() => {});
    }, USER_TIMEOUT)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

app.set("io", io);

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.use(
  "/uploads",
  express.static(path.join(path.resolve(), "uploads"))
);

// ──────────────────────────────────────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────────────────────────────────────

app.use("/api/auth",      authRoutes);
app.use("/api/seuils",    seuilRoutes);
app.use("/api/equipment", EquipmentRoutes);
app.use("/api/user",      userRoutes);
app.use("/api/alerts",    alertRoutes);
app.use("/api",           reportsRoutes);
app.use("/api/users",     adminUsersRoutes);
app.use("/api",           dashboardRoutes);
app.use("/api",           PdashboardRoutes);

// ──────────────────────────────────────────────────────────────────────────────
// SENSOR DATA
// ──────────────────────────────────────────────────────────────────────────────

app.post("/internal/sensor-data", (req, res) => {
  const payload = req.body;

  if (payload.type === "luminosite") {
    sensorStore.lightLevel = payload.lightLevel ?? sensorStore.lightLevel;
    sensorStore.blinds     = payload.blinds     ?? sensorStore.blinds;
    sensorStore.lampsState = payload.lampsState ?? sensorStore.lampsState;
    sensorStore.lampsPWM   = payload.lampsPWM   ?? sensorStore.lampsPWM;
    sensorStore.lastUpdate = payload.timestamp;

    io.emit("sensor:luminosite", {
      lightLevel: sensorStore.lightLevel,
      blinds:     sensorStore.blinds,
      lampsState: sensorStore.lampsState,
      lampsPWM:   sensorStore.lampsPWM,
      timestamp:  sensorStore.lastUpdate,
    });
  }

  if (payload.type === "pzem") {
    sensorStore.tension   = payload.tension   ?? 0;
    sensorStore.courant   = payload.courant   ?? 0;
    sensorStore.puissance = payload.puissance ?? 0;
    sensorStore.energie   = payload.energie   ?? 0;
    sensorStore.frequence = payload.frequence ?? 0;
    sensorStore.pf        = payload.pf        ?? 0;
    sensorStore.rssi      = payload.rssi      ?? 0;
    sensorStore.lastUpdate = payload.timestamp;

    io.emit("sensor:pzem", {
      tension:   sensorStore.tension,
      courant:   sensorStore.courant,
      puissance: sensorStore.puissance,
      energie:   sensorStore.energie,
      frequence: sensorStore.frequence,
      pf:        sensorStore.pf,
      rssi:      sensorStore.rssi,
      timestamp: sensorStore.lastUpdate,
    });
  }

  if (payload.type === "actuator-status") {
    const { mac, actuatorType, roomId, floor, room } = payload;

    let value = payload.value;
    if (actuatorType === 'led_strip' && typeof value === 'boolean') {
      value = value ? 200 : 0;
    }

    _cacheActuatorState(mac, actuatorType, value, roomId, floor, room);
    _markDeviceOnline(mac);

    io.emit("actuator:status", {
      mac:         (mac || "").toUpperCase(),
      actuatorType,
      value,
      roomId,
      floor,
      room,
      timestamp:   Date.now(),
    });
  }

  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /internal/actuator-status
//
// Appelé par BackM (lightAutomation, etc.) pour notifier BackApp
// d'un changement d'état LED, quelle que soit la source.
//
// Payload accepté :
//   { mac, actuatorType, value, roomId, floor, room,
//     on, brightness, color,
//     source: 'app'|'switch'|'system'|'automation' }
//
// Comportement selon source :
//   "switch"     → interrupteur physique GPIO4 a agi
//                  → UI doit afficher "Contrôle local actif 🔌"
//                  → slider désactivé temporairement
//   "app"        → confirmation commande admin/chef
//                  → UI normale, source connue
//   "system"     → appui long interrupteur → automation reprend
//                  → UI revient en mode automatique
//   "automation" → BackM automation (seuil lumière, météo…)
//                  → icône 🤖
// ──────────────────────────────────────────────────────────────────────────────
app.post('/internal/actuator-status', (req, res) => {
  const {
    mac, actuatorType, value,
    roomId, floor, room,
    on, brightness, color,
    source,
  } = req.body;

  if (!mac || !actuatorType) {
    return res.status(400).json({ ok: false, reason: 'mac et actuatorType requis' });
  }

  console.log(
    `[BackApp] 🔔 actuator-status: ${mac}/${actuatorType}=${value}` +
    ` source=${source ?? 'n/a'} roomId=${roomId}`
  );

  // Mise à jour cache avec tous les champs enrichis
  _cacheActuatorState(mac, actuatorType, value, roomId, floor, room, {
    on, brightness, color, source,
  });

  // Résolution roomId depuis le cache si absent dans le payload
  let resolvedRoomId = roomId;
  if (!resolvedRoomId) {
    const upperMac  = (mac || '').toUpperCase();
    const deviceMap = actuatorStateCache.get(upperMac);
    const entry     = deviceMap?.get(actuatorType);
    if (entry?.roomId) {
      resolvedRoomId = entry.roomId;
      console.log(`[BackApp] 🔍 roomId résolu depuis cache : ${resolvedRoomId}`);
    }
  }

  // Payload complet forwardé vers les frontends
  const statusPayload = {
    mac:         (mac || '').toUpperCase(),
    actuatorType,
    value,
    roomId:      resolvedRoomId,
    floor:       floor ?? null,
    room:        room  ?? null,
    // Champs LED enrichis
    on:          on         ?? null,
    brightness:  brightness ?? null,
    color:       color      ?? null,
    // source — le champ clé pour l'UI
    source:      source     ?? 'automation',
    timestamp:   Date.now(),
  };

  // Admin reçoit toujours
  io.to('admin:monitor').emit('actuator:status', statusPayload);

  // Chef reçoit via sa room
  if (resolvedRoomId) {
    io.to(`room:${resolvedRoomId}`).emit('actuator:status', statusPayload);
  } else {
    console.warn(`[BackApp] ⚠️ automation status sans roomId — broadcast global`);
    io.emit('actuator:status', statusPayload);
  }

  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// REGISTRE DE PRÉSENCE RÉSEAU
// ──────────────────────────────────────────────────────────────────────────────

const DEVICE_OFFLINE_TIMEOUT_MS = 30_000;
const _offlineTimers = new Map();

function _markDeviceOnline(mac) {
  if (!mac) return;
  const upperMac  = (mac || '').toUpperCase();
  const wasOnline = devicePresenceRegistry.get(upperMac) === true;

  devicePresenceRegistry.set(upperMac, true);

  Equipment.findOneAndUpdate(
    { mac: upperMac },
    { isOnline: true, status: 'online', lastHeartbeat: new Date() }
  ).catch(err => console.error('[BackApp] ❌ markOnline DB error:', err));

  if (!wasOnline) {
    console.log(`[BackApp] 🟢 device:online → ${upperMac}`);
    io.emit('device:online', { mac: upperMac });
  }

  if (_offlineTimers.has(upperMac)) {
    clearTimeout(_offlineTimers.get(upperMac));
  }
  _offlineTimers.set(
    upperMac,
    setTimeout(() => _markDeviceOffline(upperMac), DEVICE_OFFLINE_TIMEOUT_MS)
  );
}

function _markDeviceOffline(mac) {
  if (!mac) return;
  const upperMac  = (mac || '').toUpperCase();
  const wasOnline = devicePresenceRegistry.get(upperMac) === true;

  devicePresenceRegistry.set(upperMac, false);
  _offlineTimers.delete(upperMac);

  Equipment.findOneAndUpdate(
    { mac: upperMac },
    { isOnline: false, status: 'offline' }
  ).catch(err => console.error('[BackApp] ❌ markOffline DB error:', err));

  if (wasOnline) {
    console.log(`[BackApp] 🔴 device:offline → ${upperMac}`);
    io.emit('device:offline', { mac: upperMac });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CONNEXION BACKM
// ──────────────────────────────────────────────────────────────────────────────

const BACKM_URL = process.env.BACKM_URL || "http://172.28.40.165:5050";

const backMSocket = ioClient(BACKM_URL, {
  reconnection:         true,
  reconnectionDelay:    2000,
  reconnectionAttempts: Infinity,
});

registerBackMListeners(
  io,
  backMSocket,
  _cacheActuatorState,
  actuatorStateCache,
  _markDeviceOnline,
  _markDeviceOffline,
);

backMSocket.on('new-alert', (payload) => {
  console.log(
    `[BackApp] 📨 Alerte reçue de BackM — ` +
    `level=${payload.level} type=${payload.type} device=${payload.deviceId}`
  );
  io.emit('new-alert', payload);
});
backMSocket.on("connect", () => {
  console.log(`[BackApp] ✅ Connecté au BackM (${BACKM_URL}) — id: ${backMSocket.id}`);
});
backMSocket.on("connect_error", (err) => {
  console.error(`[BackApp] ❌ Impossible de joindre BackM :`, err.message);
});
backMSocket.on("disconnect", (reason) => {
  console.warn("[BackApp] ⚠️ Déconnecté du BackM :", reason);
});

// ──────────────────────────────────────────────────────────────────────────────
// JWT MIDDLEWARE SOCKET.IO
// ──────────────────────────────────────────────────────────────────────────────

io.use((socket, next) => {
  const token    = socket.handshake.auth?.token;
  const authData = socket.handshake.auth ?? {};

  if (!token) {
    socket.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.user = {
      ...decoded,
      functionalGrade:  authData.functionalGrade  ?? decoded.functionalGrade,
      officeRoom:       authData.officeRoom        ?? decoded.officeRoom,
      floor:            authData.floor             ?? decoded.floor,
      additionalAccess: authData.additionalAccess  ?? decoded.additionalAccess,
    };

    console.log(
      `[BackApp] Socket ${socket.id} — JWT OK` +
      ` | user=${decoded.id} | role=${socket.user.role}` +
      ` | grade=${socket.user.functionalGrade}` +
      ` | officeRoom=${socket.user.officeRoom}`
    );
    next();
  } catch (err) {
    console.error(`[BackApp] Socket ${socket.id} — JWT invalide :`, err.message);
    socket.user = null;
    next();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SOCKET.IO FRONTEND
// ──────────────────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  if (socket.user?.id) {
    markUserOnline(socket.user.id);
  }

  socket.on("user:heartbeat", () => {
    if (socket.user?.id) {
      markUserOnline(socket.user.id);
    }
  });

  socket.on("disconnect", () => {
    if (socket.user?.id) {
      User.findByIdAndUpdate(socket.user.id, {
        isOnline: false,
        lastSeen: new Date(),
      }).catch(() => {});
    }
  });

  console.log(
    `🟢 Client connecté : ${socket.id}` +
    ` | role=${socket.user?.role ?? "anonymous"}` +
    ` | grade=${socket.user?.functionalGrade ?? "-"}`
  );

  socket.emit("sensor:init", sensorStore);

  registerActuatorHandlers(io, socket, backMSocket, _cacheActuatorState);

  // ── Request states ─────────────────────────────────────────────────────────
  // Retourne les derniers états connus (cache → DB fallback).
  // Pour led_strip, le champ "source" est inclus dans chaque entrée
  // pour que l'UI sache qui contrôlait la LED au dernier état connu.
  socket.on('actuator:requestStates', async ({ macs } = {}) => {
    if (!Array.isArray(macs) || macs.length === 0) {
      return socket.emit('actuator:states', []);
    }

    console.log('[BackApp] 📥 actuator:requestStates — MACs:', macs);

    const bulk       = [];
    const missedMacs = [];

    // 1. Chercher dans le cache mémoire
    macs.forEach((mac) => {
      const upperMac = (mac || '').toUpperCase();
      const macMap   = actuatorStateCache.get(upperMac);

      if (macMap && macMap.size > 0) {
        macMap.forEach((entry, actuatorType) => {
          // entry contient maintenant : value, roomId, floor, room,
          //                             on, brightness, color, source
          bulk.push({
            mac: upperMac,
            actuatorType,
            ...entry,
            timestamp: Date.now(),
          });
        });
      } else {
        missedMacs.push(upperMac);
      }
    });

    // 2. Fallback DB pour les MACs absents du cache
    if (missedMacs.length > 0) {
      console.log('[BackApp] 🔍 fallback DB pour:', missedMacs);
      try {
        const equipments = await Equipment.find({
          mac: { $in: missedMacs }
        }).lean();

        for (const eq of equipments) {
          for (const actuator of eq.actuators ?? []) {
            if (actuator.lastValue === undefined) continue;

            const upperMac = eq.mac.toUpperCase();
            const entry = {
              mac:          upperMac,
              actuatorType: actuator.type,
              value:        actuator.lastValue,
              roomId:       String(eq.officeRoom ?? eq.roomId ?? ''),
              floor:        eq.floor ?? null,
              room:         null,
              // Champs LED depuis DB (persistés par _cacheActuatorState)
              on:         null,
              brightness: null,
              color:      null,
              source:     actuator.lastSource ?? null,   // ← récupéré depuis DB
              timestamp:  Date.now(),
            };

            bulk.push(entry);
            _cacheActuatorState(
              upperMac, actuator.type, actuator.lastValue,
              entry.roomId, entry.floor, null,
              { source: entry.source }
            );
          }
        }
      } catch (err) {
        console.error('[BackApp] ❌ fallback DB error:', err);
      }
    }

    console.log(`[BackApp] 📤 actuator:states → ${bulk.length} entrées`);
    socket.emit('actuator:states', bulk);

    // Notifier le statut réseau réel de chaque MAC
    macs.forEach((mac) => {
      const upperMac = (mac || '').toUpperCase();
      const isOnline = devicePresenceRegistry.get(upperMac) === true;

      if (isOnline) {
        socket.emit('device:online',  { mac: upperMac });
      } else {
        socket.emit('device:offline', { mac: upperMac });
      }
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BRIDGE + DASHBOARD
// ──────────────────────────────────────────────────────────────────────────────

initBridge(io);

function buildDashboardPayload() {
  return {
    stats: {
      energy:    { value: sensorStore.energie,   unit: "kWh", change: 0, trend: "up" },
      puissance: { value: sensorStore.puissance, unit: "W"   },
      tension:   { value: sensorStore.tension,   unit: "V"   },
      courant:   { value: sensorStore.courant,   unit: "A"   },
      luminosite: {
        value:      sensorStore.lightLevel,
        unit:       "%",
        blinds:     sensorStore.blinds,
        lampsState: sensorStore.lampsState,
        lampsPWM:   sensorStore.lampsPWM,
      },
      alerts: { count: sensorStore.lightLevel === 0 ? 1 : 0, change: 0, trend: "down" },
    },
    iotDistribution: {
      lights: sensorStore.lampsState === "on" ? sensorStore.lampsPWM : 0,
      blinds: sensorStore.blinds === "open" ? 100 : 0,
      others: 0,
      total:  32,
    },
    lastUpdate: sensorStore.lastUpdate,
  };
}

setInterval(() => io.emit("Adashboard-update", buildDashboardPayload()), 5000);
setInterval(() => io.emit("dashboard-update",  buildDashboardPayload()), 5000);

// ──────────────────────────────────────────────────────────────────────────────
// ROUTES STATIQUES + MONGODB
// ──────────────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => res.send("Serveur OK !"));

app.get("/reset-password", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});

app.get("/reset-password/:token", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "reset-password.html"),
    (err) => { if (err) res.status(500).send("Erreur serveur"); }
  );
});

// Préchauffage du cache au démarrage
async function warmActuatorCache() {
  const equipments = await Equipment.find({
    'actuators.0': { $exists: true }
  }).lean();

  for (const eq of equipments) {
    for (const actuator of eq.actuators ?? []) {
      if (actuator.lastValue === undefined) continue;

      _cacheActuatorState(
        eq.mac,
        actuator.type,
        actuator.lastValue,
        String(eq.officeRoom ?? eq.roomId ?? ''),
        eq.floor ?? null,
        null,
        // Restaurer la source depuis DB si elle a été persistée
        { source: actuator.lastSource ?? null }
      );
    }
  }
  console.log(`[BackApp] 🔥 Cache préchauffé — ${actuatorStateCache.size} MACs`);

  // Pré-remplir devicePresenceRegistry depuis la DB
  try {
    const onlineEquipments = await Equipment.find({ isOnline: true }).lean();
    for (const eq of onlineEquipments) {
      if (eq.mac) {
        const upperMac = eq.mac.toUpperCase();
        devicePresenceRegistry.set(upperMac, true);
        if (_offlineTimers.has(upperMac)) clearTimeout(_offlineTimers.get(upperMac));
        _offlineTimers.set(
          upperMac,
          setTimeout(() => _markDeviceOffline(upperMac), DEVICE_OFFLINE_TIMEOUT_MS)
        );
      }
    }
    console.log(`[BackApp] 🟢 Présence réseau pré-remplie — ${onlineEquipments.length} devices online depuis DB`);
  } catch (e) {
    console.error('[BackApp] ❌ Erreur pré-remplissage devicePresenceRegistry:', e.message);
  }
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected ✅");
    await warmActuatorCache();
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
    startThresholdMonitor();
  })
  .catch((err) => console.log(err));