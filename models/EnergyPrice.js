// Back App/models/EnergyPrice.js
import mongoose from 'mongoose';

const energyPriceSchema = new mongoose.Schema({
  pricePerKwh: { type: Number, required: true, default: 0.2 },
  updatedAt:   { type: Date,   default: Date.now },
  updatedBy:   { type: String, default: null },
});

export default mongoose.model('EnergyPrice', energyPriceSchema);