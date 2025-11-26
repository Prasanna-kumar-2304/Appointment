const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  appointmentId: { type: String, unique: true, required: true },
  doctorId: String,
  patientId: String,
  date: String, // ISO date "2025-11-25"
  startDateTime: Date,
  endDateTime: Date,
  googleEventId: String,
  status: { type: String, default: 'confirmed' },
  paymentStatus: { type: String, default: 'pending' }
}, { timestamps: true });

module.exports = mongoose.model('Appointment', AppointmentSchema);
