// models/Equipment.js
import mongoose from 'mongoose';

const VALID_ICONS = [
  // Device icons
  'lighting', 'hvac', 'cameras', 'access', 'fire', 'water',
  // Sensor / type icons
  'temperature', 'light', 'humidity', 'pressure', 'co2', 'motion',
];

const VALID_SENSOR_TYPES = [
  'temperature', 'light', 'humidity', 'pressure', 'co2', 'motion',
];

/**
 * Equipment Model
 * Fields: name, nodeId, ipAddress, location, description, status, icon, sensors, lastSeen
 */
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
    ipAddress: {
      type: String,
      required: [true, 'IP Address is required'],
      trim: true,
      validate: {
        validator: (v) =>
          /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(v),
        message: (props) =>
          `${props.value} is not a valid IPv4 address (format: xxx.xxx.xxx.xxx, 0–255)`,
      },
    },
    location: {
      type: String,
      trim: true,
      maxlength: [150, 'Location cannot exceed 150 characters'],
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
        values: ['online', 'offline'],
        message: 'Status must be "online" or "offline"',
      },
      default: 'offline',
    },

    // ── Device icon (chosen in Add/Edit modal IconPicker) ──────────────────
    icon: {
      type: String,
      enum: {
        values: VALID_ICONS,
        message: `Icon must be one of: ${VALID_ICONS.join(', ')}`,
      },
      default: 'lighting',
    },

    // ── Attached sensors — flat array of type strings e.g. ['temperature', 'humidity'] ──
    sensors: {
      type: [{ type: String, enum: { values: VALID_SENSOR_TYPES, message: `Sensor type must be one of: ${VALID_SENSOR_TYPES.join(', ')}` } }],
      default: [],
    },

    lastSeen: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,   // adds createdAt / updatedAt
    versionKey: false,
  }
);

equipmentSchema.index({ status: 1 });

// Virtual: human-readable lastSeen for the frontend list card
equipmentSchema.virtual('lastSeenFormatted').get(function () {
  return this.lastSeen ? this.lastSeen.toLocaleString() : null;
});

equipmentSchema.set('toJSON', { virtuals: true });

const Equipment = mongoose.model('Equipment', equipmentSchema);

export default Equipment;