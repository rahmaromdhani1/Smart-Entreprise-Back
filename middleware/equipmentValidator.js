// middleware/equipmentValidator.js
import { body, param } from 'express-validator';

// Must mirror VALID_ICONS in Equipment.js and NODE_ICONS/SENSOR_TYPES in AdminControl.jsx
const VALID_ICONS = [
  'lighting', 'hvac', 'cameras', 'access', 'fire', 'water',
  'temperature', 'light', 'humidity', 'pressure', 'co2', 'motion',
];

const VALID_SENSOR_TYPES = [
  'temperature', 'light', 'humidity', 'pressure', 'co2', 'motion',
];

export const createEquipmentRules = [
  body('name')
    .notEmpty().withMessage('Equipment name is required').bail()
    .trim()
    .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),

  body('nodeId')
    .notEmpty().withMessage('Node ID is required').bail()
    .trim()
    .toUpperCase()
    .isLength({ max: 50 }).withMessage('Node ID cannot exceed 50 characters'),

  body('ipAddress')
    .notEmpty().withMessage('IP Address is required').bail()
    .matches(
      /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/
    )
    .withMessage('Invalid IPv4 address'),

  body('location')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Location cannot exceed 150 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),

  // ── icon ──────────────────────────────────────────────────────────────────
  body('icon')
    .optional()
    .isIn(VALID_ICONS)
    .withMessage(`Icon must be one of: ${VALID_ICONS.join(', ')}`),

  // ── sensors — flat array of strings e.g. ['temperature', 'humidity'] ──────
  body('sensors')
    .optional()
    .isArray().withMessage('Sensors must be an array'),

  body('sensors.*')
    .isIn(VALID_SENSOR_TYPES)
    .withMessage(`Each sensor must be one of: ${VALID_SENSOR_TYPES.join(', ')}`),
];

export const updateEquipmentRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),

  body('nodeId')
    .optional()
    .trim()
    .toUpperCase()
    .isLength({ max: 50 }).withMessage('Node ID cannot exceed 50 characters'),

  body('ipAddress')
    .optional()
    .matches(
      /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/
    )
    .withMessage('Invalid IPv4 address'),

  body('status')
    .optional()
    .isIn(['online', 'offline'])
    .withMessage('Status must be "online" or "offline"'),

  body('icon')
    .optional()
    .isIn(VALID_ICONS)
    .withMessage(`Icon must be one of: ${VALID_ICONS.join(', ')}`),

  // ── sensors — flat array of strings e.g. ['temperature', 'humidity'] ──────
  body('sensors')
    .optional()
    .isArray().withMessage('Sensors must be an array'),

  body('sensors.*')
    .isIn(VALID_SENSOR_TYPES)
    .withMessage(`Each sensor must be one of: ${VALID_SENSOR_TYPES.join(', ')}`),
];

export const equipmentIdParam = [
  param('id').isMongoId().withMessage('Invalid equipment ID'),
];