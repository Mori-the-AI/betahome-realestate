const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: String,
  location: String,
  experience: String,
  image: String,
  phone: String,
  email: String,
  whatsapp: String,
  specialties: [String],
  stats: {
    sold: Number,
    years: Number
  },
  featured: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Agent', agentSchema);