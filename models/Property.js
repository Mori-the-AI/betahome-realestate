const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: String,
  price: String,
  price_small: String,
  bedrooms: Number,
  bathrooms: Number,
  area: String,
  parking: Number,
  description: String,
  features: [String],
  main_image: String,
  thumbnails: [String],
  property_type: { type: String, enum: ['House', 'Apartment', 'Land', 'Commercial'] },
  status: { type: String, enum: ['For Sale', 'For Rent', 'Sold'] },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
  featured: { type: Boolean, default: false },
  ref: String
}, { timestamps: true });

module.exports = mongoose.model('Property', propertySchema);