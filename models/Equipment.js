// models/Equipment.js
import mongoose from 'mongoose';

const VALID_ICONS = [
  'lighting', 'hvac', 'cameras', 'access', 'fire', 'water', 'energy',
  'temperature', 'light', 'humidity', 'pressure', 'smoke', 'motion',
];

const VALID_SENSOR_TYPES = [
  'temperature', 'light', 'humidity', 'pressure', 'smoke', 'motion', 'energy',
];

const equipmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Equipment name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    nodeId: {
      type: String,
      required: [true, 'Node ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [50, 'Node ID cannot exceed 50 characters'],
    },
    mac: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
      index: true,
    },
    ipAddress: {
      type: String,
      trim: true,
      validate: {
        validator: (v) =>
          !v ||
          /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(v),
        message: (props) => `${props.value} is not a valid IPv4 address`,
      },
    },
    floor: {
      type: String,
      trim: true,
      maxlength: [100, 'Floor cannot exceed 100 characters'],
      default: '',
    },
    officeRoom: {
      type: String,
      trim: true,
      maxlength: [100, 'Office room cannot exceed 100 characters'],
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: ['online', 'offline', 'unknown'],
        message: 'Status must be "online", "offline", or "unknown"',
      },
      default: 'unknown',
    },
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastHeartbeat: {
      type: Date,
      default: null,
    },
    icon: {
      type: String,
      enum: {
        values: VALID_ICONS,
        message: `Icon must be one of: ${VALID_ICONS.join(', ')}`,
      },
      default: 'lighting',
    },
    sensors: {
      type: [
        {
          type: String,
          enum: {
            values: VALID_SENSOR_TYPES,
            message: `Sensor type must be one of: ${VALID_SENSOR_TYPES.join(', ')}`,
          },
        },
      ],
      default: [],
    },
    actuators: {
      type: [
        {
          sensorType: {
            type: String,
            required: [true, 'Actuator sensorType is required'],
          },
          type: {
            type: String,
            required: [true, 'Actuator type is required'],
          },
          controlType: {
            type: String,
            enum: ['toggle', 'slider', 'tone', 'led', 'blind'],
            required: [true, 'Actuator controlType is required'],
          },
          min:       { type: Number, default: 0   },
          max:       { type: Number, default: 255 },
          default:   { type: Number, default: 0   },
          frequency: { type: Number, default: 1000 },
          // Dernière valeur connue (brightness 0-255 pour LED)
          lastValue:  { type: mongoose.Schema.Types.Mixed, default: null },
          lastUpdate: { type: Date,   default: null },
          // ── NOUVEAU : dernière source de contrôle (LED uniquement) ─────────
          // Persisté à chaque mise à jour via _cacheActuatorState.
          // Permet de restaurer l'indicateur de contrôle au rechargement de page.
          // Valeurs : 'app' | 'switch' | 'system' | 'automation' | null
          lastSource: { type: String, default: null },
        },
      ],
      default: [],
    },
    lastSeen: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

equipmentSchema.index({ status: 1 });
equipmentSchema.index({ isOnline: 1 });
equipmentSchema.index({ mac: 1 });
equipmentSchema.index({ floor: 1, officeRoom: 1 });

equipmentSchema.virtual('lastSeenFormatted').get(function () {
  return this.lastSeen ? this.lastSeen.toLocaleString() : null;
});

equipmentSchema.set('toJSON', { virtuals: true });

equipmentSchema.methods.setOnline = async function (online = true) {
  this.isOnline = online;
  this.status   = online ? 'online' : 'offline';
  if (online) this.lastHeartbeat = new Date();
  this.updatedAt = new Date();
  return this.save();
};

equipmentSchema.methods.updateActuator = async function (actuatorType, value, source = null) {
  const actuator = this.actuators.find((a) => a.type === actuatorType);
  if (actuator) {
    actuator.lastValue  = value;
    actuator.lastUpdate = new Date();
    if (source !== null) actuator.lastSource = source;
    this.updatedAt = new Date();
    return this.save();
  }
  return null;
};

equipmentSchema.methods.updateSensor = async function (sensorType, value) {
  this.updatedAt = new Date();
  return this.save();
};

equipmentSchema.methods.getActuator = function (actuatorType) {
  return this.actuators.find((a) => a.type === actuatorType) || null;
};

equipmentSchema.methods.hasActuator = function (actuatorType) {
  return this.actuators.some((a) => a.type === actuatorType);
};

equipmentSchema.statics.findByMac    = function (mac)    { return this.findOne({ mac:    mac.toUpperCase()    }); };
equipmentSchema.statics.findByNodeId = function (nodeId) { return this.findOne({ nodeId: nodeId.toUpperCase() }); };

const Equipment = mongoose.model('Equipment', equipmentSchema);

export default Equipment;