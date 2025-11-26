const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
  patientId: { type: String, unique: true, required: true },
  name: String,
  email: String,
  phone: String,
  otp: String,
  otpCreatedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Patient', PatientSchema);
