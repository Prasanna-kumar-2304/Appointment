// Doctor.js - Mongoose Schema
const mongoose = require('mongoose');

// Define the availability sub-schema
const availabilitySchema = new mongoose.Schema({
  available: { type: Boolean, required: true },
  start: { type: String },
  end: { type: String }
}, { _id: false });

const doctorSchema = new mongoose.Schema({
  doctorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  specialty: { type: String, required: true },
  qualification: { type: String },
  experience: { type: Number },
  consultationFee: { type: Number },
  rating: { type: Number },
  calendarId: { type: String },
  timezone: { type: String, default: 'Asia/Kolkata' },
  
  // Properly define the availability object
  availability: {
    monday: { type: availabilitySchema, default: { available: false } },
    tuesday: { type: availabilitySchema, default: { available: false } },
    wednesday: { type: availabilitySchema, default: { available: false } },
    thursday: { type: availabilitySchema, default: { available: false } },
    friday: { type: availabilitySchema, default: { available: false } },
    saturday: { type: availabilitySchema, default: { available: false } },
    sunday: { type: availabilitySchema, default: { available: false } }
  }
}, { 
  timestamps: true,
  strict: false // This allows flexibility but maintain structure for availability
});

module.exports = mongoose.model('Doctor', doctorSchema);
