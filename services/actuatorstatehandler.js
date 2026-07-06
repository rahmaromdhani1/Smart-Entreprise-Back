// ─────────────────────────────────────────────────────────────────────────────
// À AJOUTER dans BackApp — là où vous gérez les events socket (io.on('connection'))
//
// BackApp doit tenir un cache des derniers états connus des actuateurs.
// Ce cache est mis à jour à chaque réception de 'actuator:status' venant de BackM.
// ─────────────────────────────────────────────────────────────────────────────

// 1. Cache en mémoire : Map<mac_UPPER, Map<actuatorType, value>>
//    À déclarer UNE FOIS au niveau module, avant io.on('connection')
const actuatorStateCache = new Map(); // Map<mac, Map<actuatorType, value>>

function updateActuatorCache(mac, actuatorType, value) {
  const upperMac = (mac || '').toUpperCase();
  if (!actuatorStateCache.has(upperMac)) {
    actuatorStateCache.set(upperMac, new Map());
  }
  actuatorStateCache.get(upperMac).set(actuatorType, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Exemple d'intégration complète dans votre fichier server/socket BackApp
// ─────────────────────────────────────────────────────────────────────────────

/*
// Quand BackM envoie un état réel (via backMSocket ou via mqtt bridge) :
backMSocket.on('actuator:status', (payload) => {
  const { mac, actuatorType, value, roomId, floor, room } = payload;

  // ✅ Mettre à jour le cache
  updateActuatorCache(mac, actuatorType, value);

  // Diffuser à tous les clients frontend concernés (comportement existant)
  io.emit('actuator:status', { mac, actuatorType, value, timestamp: Date.now() });
});
*/

// ─────────────────────────────────────────────────────────────────────────────
// 4. Handler du nouveau event 'actuator:requestStates'
//    À placer DANS io.on('connection', (socket) => { ... })
// ─────────────────────────────────────────────────────────────────────────────
/*
io.on('connection', (socket) => {

  // ... vos handlers existants ...

  // ✅ NOUVEAU — le frontend demande les états actuels pour une liste de MACs
  socket.on('actuator:requestStates', ({ macs }) => {
    if (!Array.isArray(macs) || macs.length === 0) return;

    console.log('[BackApp] actuator:requestStates — MACs:', macs);

    // Option A — réponse individuelle par actuateur (compatible avec le handler
    //            'actuator:status' déjà présent dans Control.jsx)
    macs.forEach((mac) => {
      const upperMac = (mac || '').toUpperCase();
      const deviceCache = actuatorStateCache.get(upperMac);
      if (!deviceCache) {
        console.log(`[BackApp] Pas d'état en cache pour ${upperMac}`);
        return;
      }
      deviceCache.forEach((value, actuatorType) => {
        socket.emit('actuator:status', {
          mac:          upperMac,
          actuatorType,
          value,
          timestamp:    Date.now(),
          source:       'cache',
        });
      });
    });

    // Option B — réponse bulk en un seul event 'actuator:states'
    //            (également géré dans Control.jsx)
    const bulk = [];
    macs.forEach((mac) => {
      const upperMac    = (mac || '').toUpperCase();
      const deviceCache = actuatorStateCache.get(upperMac);
      if (!deviceCache) return;
      deviceCache.forEach((value, actuatorType) => {
        bulk.push({ mac: upperMac, actuatorType, value });
      });
    });

    if (bulk.length > 0) {
      console.log(`[BackApp] actuator:states (bulk) → ${bulk.length} entrées`);
      socket.emit('actuator:states', bulk);
    }
  });

});
*/

module.exports = { updateActuatorCache, actuatorStateCache };