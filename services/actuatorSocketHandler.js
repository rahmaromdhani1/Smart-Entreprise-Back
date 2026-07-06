// services/actuatorSocketHandler.js
import Equipment from '../models/Equipment.js';

// ── Permission ────────────────────────────────────────────────────────────────
function canControl(socket, roomId) {
  const user = socket.user;
  if (!user) return false;
  if (user.role === 'Admin') return true;

  if (user.role === 'Staff') {
    const grade = user.functionalGrade?.toLowerCase();
    if (grade !== 'chef') return false;

    const allRoomIds = new Set();
    if (user.officeRoom) allRoomIds.add(String(user.officeRoom));
    if (user.roomId)     allRoomIds.add(String(user.roomId));
    (user.additionalAccess ?? []).forEach(a => {
      if (a?.officeRoom) allRoomIds.add(String(a.officeRoom));
      if (a?.roomId)     allRoomIds.add(String(a.roomId));
    });

    return allRoomIds.has(String(roomId));
  }
  return false;
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateCommandPayload(payload, isAdmin = false) {
  const { mac, sensorType, actuatorType, controlType, value, roomId } = payload ?? {};

  if (!mac || !sensorType || !actuatorType || !controlType)
    return { ok: false, reason: 'Champs manquants (mac / sensorType / actuatorType / controlType)' };

  if (!isAdmin && !roomId)
    return { ok: false, reason: 'roomId manquant' };

  const valid = ['toggle', 'slider', 'tone', 'led', 'blind'];
  if (!valid.includes(controlType))
    return { ok: false, reason: 'controlType invalide' };

  if (controlType === 'toggle' && typeof value !== 'boolean')
    return { ok: false, reason: 'toggle doit être boolean' };

  if (controlType === 'slider' && typeof value !== 'number')
    return { ok: false, reason: 'slider doit être number' };

  if (controlType === 'led' && typeof value !== 'number')
    return { ok: false, reason: 'led doit être number 0-255' };

  return { ok: true };
}

// ── Resolve actuator depuis DB ────────────────────────────────────────────────
async function resolveActuator(mac, actuatorType) {
  if (!mac) return null;
  const equipment = await Equipment.findOne({ mac: mac.toUpperCase() }).lean();
  if (!equipment) return null;
  const actuator = equipment.actuators?.find(a => a.type === actuatorType);
  if (!actuator) return null;
  return { equipment, actuator };
}

// ── registerActuatorHandlers ──────────────────────────────────────────────────
export function registerActuatorHandlers(io, socket, backMSocket, cacheActuatorState) {

  socket.removeAllListeners('actuator:command');

  // Rejoindre les rooms
  const rooms = new Set();
  if (socket.user?.officeRoom) rooms.add(String(socket.user.officeRoom));
  if (socket.user?.roomId)     rooms.add(String(socket.user.roomId));
  (socket.user?.additionalAccess ?? []).forEach(a => {
    if (a?.officeRoom) rooms.add(String(a.officeRoom));
    if (a?.roomId)     rooms.add(String(a.roomId));
  });
  for (const roomId of rooms) {
    socket.join(`room:${roomId}`);
    console.log(
      `[BackApp] ✅ Socket ${socket.id} → room:${roomId}` +
      ` | user=${socket.user?.id} | role=${socket.user?.role}`
    );
  }
  if (rooms.size === 0) {
    console.warn(
      `[BackApp] ⚠️ Socket ${socket.id} — aucune room jointe` +
      ` | officeRoom=${socket.user?.officeRoom} | roomId=${socket.user?.roomId}`
    );
  }

  if (socket.user?.role === 'Admin') socket.join('admin:monitor');

  // ── actuator:command ──────────────────────────────────────────────────────
  socket.on('actuator:command', async (payload) => {
    const isAdmin = socket.user?.role === 'Admin';

    const { ok, reason } = validateCommandPayload(payload, isAdmin);
    if (!ok) return socket.emit('actuator:error', { message: reason });

    const { mac, sensorType, actuatorType, controlType, value } = payload;
    let { roomId } = payload;

    if (!canControl(socket, roomId))
      return socket.emit('actuator:error', { message: 'Permission refusée' });

    const resolved = await resolveActuator(mac, actuatorType);
    if (!resolved)
      return socket.emit('actuator:error', { message: 'Actuator introuvable' });

    const equipFloor = resolved.equipment.floor      ?? null;
    const equipRoom  = resolved.equipment.officeRoom ?? null;

    if (isAdmin) {
      roomId = resolved.equipment.roomId ?? resolved.equipment.officeRoom ?? roomId ?? null;
    }

    const forwardPayload = {
      ...payload,
      floor:     equipFloor,
      room:      equipRoom,
      roomId,
      userId:    socket.user?.id ?? socket.user?._id,
      isAdmin,
      timestamp: Date.now(),
    };

    console.log(
      `[BackApp] 📤 actuator:forward → ${mac}/${actuatorType}` +
      ` value=${JSON.stringify(value)} roomId=${roomId} isAdmin=${isAdmin} source=app`
    );

    backMSocket.emit('actuator:forward', forwardPayload);

    // ── Optimistic broadcast ─────────────────────────────────────────────────
    // source = "app" car cette commande vient de l'interface admin/chef.
    // L'UI peut ainsi afficher immédiatement le bon indicateur de contrôle
    // sans attendre la confirmation stat/led_strip de l'ESP32.
    const statusPayload = {
      mac:         (mac || '').toUpperCase(),
      actuatorType,
      value,
      roomId,
      floor:       equipFloor,
      room:        equipRoom,
      // Champs enrichis LED
      on:          controlType === 'led' ? value > 0 : null,
      brightness:  controlType === 'led' ? value     : null,
      color:       payload.color         ?? null,
      source:      'app',          // ← commande admin/chef = source APP
      timestamp:   Date.now(),
      optimistic:  true,           // ← tag pour que l'UI sache que c'est optimiste
    };

    if (typeof cacheActuatorState === 'function') {
      cacheActuatorState(
        statusPayload.mac, actuatorType, value,
        roomId, equipFloor, equipRoom,
        { on: statusPayload.on, brightness: statusPayload.brightness,
          color: statusPayload.color, source: 'app' }
      );
    }

    if (roomId) {
      console.log(`[BackApp] ⚡ Optimistic broadcast → room:${roomId} + admin:monitor`);
      io.to(`room:${roomId}`).emit('actuator:status', statusPayload);
    } else {
      console.warn('[BackApp] ⚠️ roomId null — broadcast admin:monitor uniquement');
    }
    io.to('admin:monitor').emit('actuator:status', statusPayload);

    socket.emit('actuator:ack', {
      mac,
      actuatorType,
      value,
      controlType,
      source:    'app',
      timestamp: Date.now(),
    });
  });
}

// ── registerBackMListeners ────────────────────────────────────────────────────
export function registerBackMListeners(
  io,
  backMSocket,
  cacheActuatorState,
  actuatorStateCache,
  markDeviceOnline,
  markDeviceOffline,
) {

  // ── actuator:status — reçu depuis BackM ──────────────────────────────────
  // Le payload contient maintenant :
  //   { mac, actuatorType, value, roomId, floor, room,
  //     on, brightness, color,
  //     source: 'app'|'switch'|'system'|null,
  //     sourceDevice: 'device' }
  //
  // source = "switch"  → l'interrupteur physique a agi → l'UI affiche l'icône 🔌
  // source = "app"     → confirmation ESP32 d'une commande admin → icône 📱
  // source = "system"  → automation BackM → icône 🤖
  // source = null      → legacy, pas de source → comportement neutre
  backMSocket.on('actuator:status', (data) => {
    let { mac, actuatorType, value, roomId, floor, room,
          on, brightness, color, source } = data;

    // ── Normalisation valeur LED ─────────────────────────────────────────────
    // L'ESP32 envoie toujours un number 0-255 maintenant,
    // mais on garde la conversion legacy pour les anciens firmwares.
    let normalizedValue = value;
    if (actuatorType === 'led_strip') {
      if (typeof value === 'boolean') {
        const upperMac  = (mac || '').toUpperCase();
        const deviceMap = actuatorStateCache?.get(upperMac);
        const entry     = deviceMap?.get(actuatorType);
        normalizedValue = value ? (entry?.value > 0 ? entry.value : 200) : 0;
        console.log(`[BackApp] 🔧 led_strip boolean→number : ${value} → ${normalizedValue}`);
      } else if (typeof value === 'number') {
        normalizedValue = Math.round(value);
      }
      // Réconcilier on/brightness depuis la valeur normalisée si absents
      if (on         === undefined || on         === null) on         = normalizedValue > 0;
      if (brightness === undefined || brightness === null) brightness = normalizedValue;
    }

    // ── Résolution roomId depuis le cache si absent ──────────────────────────
    if (!roomId && actuatorStateCache) {
      const upperMac  = (mac || '').toUpperCase();
      const deviceMap = actuatorStateCache.get(upperMac);
      const entry     = deviceMap?.get(actuatorType);
      if (entry?.roomId) {
        roomId = entry.roomId;
        floor  = floor ?? entry.floor;
        room   = room  ?? entry.room;
        console.log(`[BackApp] 🔍 roomId récupéré depuis cache : ${roomId}`);
      }
    }

    // ── Mise à jour du cache (inclut source pour led_strip) ──────────────────
    if (typeof cacheActuatorState === 'function') {
      cacheActuatorState(
        mac, actuatorType, normalizedValue, roomId, floor, room,
        // Champs enrichis LED — ignorés par les autres actuateurs
        { on, brightness, color, source }
      );
    }

    // ── Marquer le device online ─────────────────────────────────────────────
    markDeviceOnline(mac);

    const statusPayload = {
      mac:         (mac || '').toUpperCase(),
      actuatorType,
      value:       normalizedValue,
      roomId,
      floor,
      room,
      // Champs LED enrichis (null pour les autres actuateurs — inoffensif côté UI)
      on:          actuatorType === 'led_strip' ? on         : null,
      brightness:  actuatorType === 'led_strip' ? brightness : null,
      color:       actuatorType === 'led_strip' ? (color ?? '#FFFFFF') : null,
      // source = qui contrôle la LED en ce moment
      //   "switch"  → interrupteur physique GPIO4
      //   "app"     → commande admin/chef
      //   "system"  → automation BackM
      //   null      → ancien firmware sans champ source
      source:      source ?? null,
      timestamp:   Date.now(),
    };

    console.log(
      `[BackApp] 📡 actuator:status → mac=${statusPayload.mac}` +
      ` type=${actuatorType} value=${JSON.stringify(normalizedValue)}` +
      ` source=${source ?? 'n/a'} roomId=${roomId}`
    );

    // Admin reçoit toujours tous les statuts
    io.to('admin:monitor').emit('actuator:status', statusPayload);

    // Chef reçoit via sa room
    if (roomId) {
      io.to(`room:${roomId}`).emit('actuator:status', statusPayload);
    } else {
      console.warn(`[BackApp] ⚠️ actuator:status sans roomId — broadcast global`);
      io.emit('actuator:status', statusPayload);
    }
  });

  // ── device:online / offline ───────────────────────────────────────────────
  backMSocket.on('device:online',  (d) => {
    if (d?.mac) markDeviceOnline(d.mac);
    io.emit('device:online', d);
  });
  backMSocket.on('device:offline', (d) => {
    if (d?.mac) markDeviceOffline(d.mac);
    io.emit('device:offline', d);
  });
}