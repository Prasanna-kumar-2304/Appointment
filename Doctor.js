const mongoose = require('mongoose');

const DoctorSchema = new mongoose.Schema({
  doctorId: { type: String, unique: true, required: true },
  name: String,
  specialization: String,
  location: String,
  email: String,
  phone: String,
  calendarId: String, // Google Calendar ID
  timezone: { type: String, default: 'Asia/Kolkata' },
  workingHours: {
    start: String, // "09:00"
    end: String    // "17:00"
  }
}, { timestamps: true });

module.exports = mongoose.model('Doctor', DoctorSchema);
