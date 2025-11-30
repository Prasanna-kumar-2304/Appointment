const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  appointmentId: { type: String, unique: true, required: true },
  doctorId: { type: String, required: true },
  doctorName: { type: String, required: true },
  doctorSpecialty: { type: String, required: true },
  patientId: { type: String }, // Optional but stored if exists
  patientName: { type: String, required: true },
  patientPhone: { type: String },
  patientEmail: { type: String, required: true },  
  date: { type: String, required: true }, 
  timeSlot: { type: String, required: true },
  startDateTime: Date,
  endDateTime: Date,
  googleEventId: String,
  status: { type: String, default: "confirmed" },
  paymentStatus: { type: String, default: "pending" }
}, { timestamps: true });

module.exports = mongoose.model("Appointment", AppointmentSchema);
