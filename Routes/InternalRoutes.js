// internalRoutes.js
const express = require("express");
const router  = express.Router();
const { sensorStore } = require("./sensorStore");

let _io = null;

// Injecter l'instance Socket.IO depuis server.js
function setIO(io) {
    _io = io;
}

// ── POST /internal/sensor-data ──────────────────────────────────
// Appelé par le back matériel via axios
router.post("/sensor-data", (req, res) => {
    const payload = req.body;

    if (payload.type === "luminosite") {
        sensorStore.lightLevel  = payload.lightLevel;
        sensorStore.blinds      = payload.blinds      ?? sensorStore.blinds;
        sensorStore.lampsState  = payload.lampsState  ?? sensorStore.lampsState;
        sensorStore.lampsPWM    = payload.lampsPWM    ?? sensorStore.lampsPWM;
        sensorStore.lastUpdate  = payload.timestamp;

        // Émettre au front via Socket.IO
        if (_io) {
            _io.emit("sensor:luminosite", {
                lightLevel: sensorStore.lightLevel,
                blinds:     sensorStore.blinds,
                lampsState: sensorStore.lampsState,
                lampsPWM:   sensorStore.lampsPWM,
                timestamp:  sensorStore.lastUpdate
            });
        }
    }

    if (payload.type === "pzem") {
        sensorStore.tension   = payload.tension;
        sensorStore.courant   = payload.courant;
        sensorStore.puissance = payload.puissance;
        sensorStore.energie   = payload.energie;
        sensorStore.frequence = payload.frequence;
        sensorStore.pf        = payload.pf;
        sensorStore.rssi      = payload.rssi;
        sensorStore.lastUpdate = payload.timestamp;

        // Émettre au front via Socket.IO
        if (_io) {
            _io.emit("sensor:pzem", {
                tension:   sensorStore.tension,
                courant:   sensorStore.courant,
                puissance: sensorStore.puissance,
                energie:   sensorStore.energie,
                frequence: sensorStore.frequence,
                pf:        sensorStore.pf,
                rssi:      sensorStore.rssi,
                timestamp: sensorStore.lastUpdate
            });
        }
    }

    res.json({ ok: true });
});

module.exports = { router, setIO };