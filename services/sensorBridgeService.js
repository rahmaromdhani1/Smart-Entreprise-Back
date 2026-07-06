import { io as ioClient } from 'socket.io-client';

const LOG = '[SensorBridge]';

// Map socketId → { role, floor, officeRoom, additionalAccess }
const _connectedUsers = new Map();

let _io     = null;
let _socket = null;

// ─────────────────────────────────────────────────────────────────────────────
// initBridge(io) — appelé UNE FOIS dans server.js après création du io
// ─────────────────────────────────────────────────────────────────────────────
export function initBridge(io) {
  _io = io;
  _connectToBackM();
  _setupFrontListeners();
  console.log(`${LOG} Bridge initialisé`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Connexion au back matériel
// ─────────────────────────────────────────────────────────────────────────────
function _connectToBackM() {
  const backMUrl = process.env.BACKM_URL || 'http://localhost:5050';

  _socket = ioClient(backMUrl, {
    reconnection:         true,
    reconnectionDelay:    3000,
    reconnectionAttempts: Infinity,
    transports:           ['websocket'],
  });

  _socket.on('connect', () => {
    console.log(`${LOG} ✓ Connecté au back M (${backMUrl})  id=${_socket.id}`);
  });

  _socket.on('disconnect', (reason) => {
    console.warn(`${LOG} ✗ Déconnecté du back M : ${reason}`);
  });

  _socket.on('connect_error', (err) => {
    console.error(`${LOG} Erreur connexion back M :`, err.message);
  });

  // ── Données capteurs ───────────────────────────────────────────────────────
  _socket.on('sensor:data', (data) => {
    const { floor, room } = data;
    console.log(`[bridge] → ${floor}:${room} | ${data.sensorType}=${data.value} | destinataires: ${_connectedUsers.size}`);
    _broadcastSensorData(data);
  });

  // ── Événements device — forwarded tels quels au front ─────────────────────
  ['device:online', 'device:offline', 'device:ready', 'device:unregistered'].forEach((event) => {
    _socket.on(event, (payload) => {
      _io?.emit(event, payload);
    });
  });

  // ── Statut actuateur reçu du BackM ────────────────────────────────────────
  //
  // Payload enrichi depuis le firmware + BackM :
  // {
  //   mac, actuatorType, value,           ← toujours présents
  //   on, brightness, color,              ← LED uniquement
  //   source: 'app'|'switch'|'system',    ← NOUVEAU — qui contrôle la LED
  //   roomId, floor, room,
  //   sourceDevice: 'device',             ← vient de l'ESP32 via BackM
  //   timestamp
  // }
  //
  // Le champ "source" permet à l'UI de :
  //   - Afficher l'icône correcte (🔌 switch / 📱 app / 🤖 system)
  //   - Désactiver le slider si source="switch" (l'utilisateur physique contrôle)
  //   - Afficher une bannière "Contrôle local actif" si source="switch"
  // ─────────────────────────────────────────────────────────────────────────
  _socket.on('actuator:status', (payload) => {
    const mac = (payload?.mac || '').toUpperCase();
    if (!mac) {
      console.warn(`${LOG} actuator:status reçu sans mac — ignoré`);
      return;
    }

    const room = `mac:${mac}`;
    console.log(
      `${LOG} actuator:status → room:${room}` +
      `  ${payload.actuatorType}=${payload.value}` +
      (payload.source ? `  source=${payload.source}` : '')
    );

    // Broadcast à tous les clients abonnés à cet équipement
    // Le payload est forwardé intact — le champ "source" est préservé
    _io?.to(room).emit('actuator:status', payload);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Listeners côté front
// ─────────────────────────────────────────────────────────────────────────────
function _setupFrontListeners() {
  _io.on('connection', (socket) => {

    // ── Identification utilisateur ─────────────────────────────────────────
    socket.on('identify', (userData) => {
      const {
        role             = 'Staff',
        floor            = null,
        officeRoom       = null,
        additionalAccess = [],
      } = userData || {};

      _connectedUsers.set(socket.id, {
        role,
        floor,
        officeRoom,
        additionalAccess: Array.isArray(additionalAccess) ? additionalAccess : [],
      });

      console.log(
        `${LOG} identify → ${socket.id}  role=${role}` +
        `  salle=${floor}/${officeRoom}` +
        `  +${additionalAccess?.length ?? 0} extra`
      );
    });

    // ── Abonnement au statut des actionneurs d'un équipement ───────────────
    socket.on('actuator:subscribe', ({ mac } = {}) => {
      if (!mac) {
        console.warn(`${LOG} actuator:subscribe sans mac — ignoré (socketId:${socket.id})`);
        return;
      }

      const macNorm = mac.toUpperCase();
      const room    = `mac:${macNorm}`;

      socket.join(room);
      console.log(`${LOG} socket:${socket.id} → join room:${room}`);

      if (_socket?.connected) {
        _socket.emit('actuator:subscribe', { mac: macNorm });
        console.log(`${LOG} → BackM actuator:subscribe mac:${macNorm}`);
      } else {
        console.warn(`${LOG} BackM non connecté — impossible de demander le statut pour mac:${macNorm}`);
      }
    });

    // ── Désabonnement ──────────────────────────────────────────────────────
    socket.on('actuator:unsubscribe', ({ mac } = {}) => {
      if (!mac) return;
      const macNorm = mac.toUpperCase();
      const room    = `mac:${macNorm}`;
      socket.leave(room);
      console.log(`${LOG} socket:${socket.id} → leave room:${room}`);
    });

    // ── Déconnexion ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      _connectedUsers.delete(socket.id);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffuse sensor:data selon le rôle
// ─────────────────────────────────────────────────────────────────────────────
function _broadcastSensorData(data) {
  if (!_io) return;

  const { floor, room } = data;

  _io.sockets.sockets.forEach((socket) => {
    const user = _connectedUsers.get(socket.id);
    if (!user) return;

    if (user.role === 'Admin') {
      socket.emit('sensor:data', data);
      return;
    }

    if (_hasAccess(user, floor, room)) {
      socket.emit('sensor:data', data);
    }
  });
}

function _hasAccess(user, floor, room) {
  if (String(user.floor) === String(floor) && String(user.officeRoom) === String(room)) return true;
  return user.additionalAccess.some(
    (a) => String(a.floor) === String(floor) && String(a.officeRoom) === String(room)
  );
}