const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const Doctor = require('./Doctor');
const Patient = require('./Patient');
const Appointment = require('./Appointment');

const { getFreeBusy, createEvent, listCalendars } = require('./google');

// ----------------------
// Middleware
// ----------------------
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!process.env.API_KEY) return next();
  if (!key || key !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ----------------------
// Email transport with validation and debugging
// ----------------------
function getTransporter() {
  // Debug: Log environment variables (remove in production)
  console.log('SMTP Configuration Check:');
  console.log('SMTP_HOST:', process.env.SMTP_HOST ? '✓ Set' : '✗ Missing');
  console.log('SMTP_PORT:', process.env.SMTP_PORT || '587 (default)');
  console.log('SMTP_USER:', process.env.SMTP_USER ? '✓ Set' : '✗ Missing');
  console.log('SMTP_PASS:', process.env.SMTP_PASS ? '✓ Set' : '✗ Missing');
  
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(`SMTP configuration incomplete. Missing: ${
      [
        !process.env.SMTP_HOST && 'SMTP_HOST',
        !process.env.SMTP_USER && 'SMTP_USER', 
        !process.env.SMTP_PASS && 'SMTP_PASS'
      ].filter(Boolean).join(', ')
    }`);
  }
  
  const config = {
    host: process.env.SMTP_HOST.trim(),
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: (process.env.SMTP_PORT === '465'),
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS.trim()
    },
    tls: {
      rejectUnauthorized: false
    },
    debug: true, // Enable debug output
    logger: true // Enable logging
  };
  
  console.log('Creating transporter with config:', {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.auth.user
  });
  
  return nodemailer.createTransport(config);
}

// ----------------------
// Build description
// ----------------------
function buildDescriptionPayload({ patient, doctor, reason, appointmentType, paymentStatus, doctorInstructions, attachmentUrl }) {
  const now = new Date().toISOString();

  const plain = [
    `Patient Name     : ${patient.name || '-'}`,
    `Patient Email    : ${patient.email || '-'}`,
    `Patient Phone    : ${patient.phone || '-'}`,
    `Patient ID       : ${patient.patientId || '-'}`,
    `Appointment Type : ${appointmentType || 'In-Person'}`,
    `Payment Status   : ${paymentStatus || 'pending'}`,
    `Reason / Symptoms: ${reason || '-'}`,
    `Doctor Notes     : ${doctorInstructions || '-'}`,
    `Booked Through   : Medicare AI Bot`,
    `Booking Time     : ${now}`,
    attachmentUrl ? `Attachment       : ${attachmentUrl}` : ''
  ].filter(Boolean).join('\n');

  const html = `
    <h3>Appointment Details</h3>
    <table border="0" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
      <tr><td><strong>Patient Name</strong></td><td>${patient.name || '-'}</td></tr>
      <tr><td><strong>Patient Email</strong></td><td>${patient.email || '-'}</td></tr>
      <tr><td><strong>Patient Phone</strong></td><td>${patient.phone || '-'}</td></tr>
      <tr><td><strong>Patient ID</strong></td><td>${patient.patientId || '-'}</td></tr>
      <tr><td><strong>Appointment Type</strong></td><td>${appointmentType || 'In-Person'}</td></tr>
      <tr><td><strong>Payment Status</strong></td><td>${paymentStatus || 'pending'}</td></tr>
      <tr><td><strong>Reason / Symptoms</strong></td><td>${reason || '-'}</td></tr>
      <tr><td><strong>Doctor Instructions</strong></td><td>${doctorInstructions || '-'}</td></tr>
      <tr><td><strong>Booked Through</strong></td><td>Medicare AI Bot</td></tr>
      <tr><td><strong>Booking Time</strong></td><td>${now}</td></tr>
    </table>
    ${attachmentUrl ? `<p><strong>Attachment:</strong> <a href="${attachmentUrl}">View attachment</a></p>` : ''}
  `;
  return { plain, html };
}

// ----------------------
// Email Sender with proper error handling
// ----------------------
async function sendConfirmationEmail({ toEmail, subject, htmlBody, textBody }) {
  // Validate email address exists
  if (!toEmail) {
    console.warn("No recipient email provided; skipping email send");
    return { skipped: true, reason: 'No recipient email' };
  }

  // Check SMTP configuration
  if (!process.env.SMTP_HOST) {
    console.warn("SMTP not configured; skipping email send");
    return { skipped: true, reason: 'SMTP not configured' };
  }
  
  try {
    const transporter = getTransporter();
    
    // Verify connection
    await transporter.verify();
    console.log('SMTP server connection verified');
    
    // Send email
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: toEmail,
      subject,
      text: textBody,
      html: htmlBody
    });
    
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('Email sending error:', error);
    throw error;
  }
}

// ----------------------
// BASIC ROUTES (doctors/patients/freebusy)
// ----------------------
router.get('/doctors', async (req, res) => {
  res.json(await Doctor.find({}));
});

router.post('/doctors', requireApiKey, async (req, res) => {
  const payload = req.body;
  if (!payload.doctorId) payload.doctorId = `D-${uuidv4().slice(0,8)}`;
  let doc = await Doctor.findOne({ doctorId: payload.doctorId });
  if (!doc) doc = new Doctor(payload);
  else Object.assign(doc, payload);
  await doc.save();
  res.json(doc);
});

router.post('/patients', async (req, res) => {
  const { name, email, phone } = req.body;
  if (!email && !phone) return res.status(400).json({ error: "email or phone required" });

  let patient = await Patient.findOne({ $or: [{ email }, { phone }] });
  if (!patient) {
    patient = new Patient({
      patientId: `P-${uuidv4().slice(0,8)}`,
      name, email, phone
    });
  } else {
    patient.name = name || patient.name;
    patient.phone = phone || patient.phone;
  }

  await patient.save();
  res.json(patient);
});

router.post('/doctors/:doctorId/freebusy', async (req, res) => {
  const { timeMin, timeMax } = req.body;
  const doc = await Doctor.findOne({ doctorId: req.params.doctorId });
  if (!doc) return res.status(404).json({ error: "Doctor not found" });

  const fb = await getFreeBusy(doc.calendarId, timeMin, timeMax);
  res.json(fb);
});

// ----------------------
// APPOINTMENT BOOKING ROUTE (ENHANCED)
// ----------------------
router.post('/appointments', requireApiKey, async (req, res) => {
  try {
    const {
      doctorId, patientId,
      startDateTimeISO, endDateTimeISO,
      summary, reason,
      appointmentType, paymentStatus,
      doctorInstructions, attendees
    } = req.body;

    if (!doctorId || !patientId || !startDateTimeISO || !endDateTimeISO)
      return res.status(400).json({ error: "Missing required fields" });

    const doctor = await Doctor.findOne({ doctorId });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    const patient = await Patient.findOne({ patientId });
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    const attachmentUrl = process.env.APPOINTMENT_ATTACHMENT_URL || null;
    const { plain, html } = buildDescriptionPayload({
      patient, doctor, reason, appointmentType, paymentStatus, doctorInstructions, attachmentUrl
    });

    const eventObj = {
      summary: summary || `Consultation - ${doctor.name}`,
      description: plain,
      start: { dateTime: startDateTimeISO, timeZone: doctor.timezone || 'Asia/Kolkata' },
      end: { dateTime: endDateTimeISO, timeZone: doctor.timezone || 'Asia/Kolkata' },
      attendees: [
        ...(doctor.email ? [{ email: doctor.email }] : []),
        ...(patient.email ? [{ email: patient.email }] : []),
        ...(Array.isArray(attendees) ? attendees : [])
      ]
    };

    const event = await createEvent(doctor.calendarId, eventObj);

    const appointment = new Appointment({
      appointmentId: `A-${uuidv4().slice(0,8)}`,
      doctorId,
      patientId,
      date: startDateTimeISO.split('T')[0],
      startDateTime: new Date(startDateTimeISO),
      endDateTime: new Date(endDateTimeISO),
      googleEventId: event.id,
      status: 'confirmed',
      paymentStatus: paymentStatus || 'pending'
    });

    await appointment.save();

    // Send confirmation email with proper error handling
    let emailStatus = null;
    
    if (patient.email) {
      try {
        emailStatus = await sendConfirmationEmail({
          toEmail: patient.email,
          subject: `Appointment Confirmed: ${doctor.name} on ${appointment.date}`,
          htmlBody: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Appointment Confirmation</h2>
              <p>Hi <strong>${patient.name}</strong>,</p>
              <p>Your appointment has been successfully confirmed with <strong>${doctor.name}</strong>.</p>
              ${html}
              <div style="margin-top: 30px; text-align: center;">
                <a href="${event.htmlLink}" target="_blank" 
                   style="background-color: #3498db; color: white; padding: 12px 24px; 
                          text-decoration: none; border-radius: 5px; display: inline-block; 
                          font-weight: bold;">
                  View in Google Calendar
                </a>
              </div>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
              <p style="color: #7f8c8d; font-size: 12px; text-align: center;">
                This is an automated message from Medicare AI Bot.<br>
                Please do not reply to this email.
              </p>
            </div>
          `,
          textBody: `Hi ${patient.name},\n\nYour appointment has been successfully confirmed with ${doctor.name}.\n\n${plain}\n\nView in Google Calendar: ${event.htmlLink}\n\n---\nThis is an automated message from Medicare AI Bot. Please do not reply to this email.`
        });
        
        console.log('Confirmation email sent to:', patient.email);
        
      } catch (mailErr) {
        console.error("Email send failed:", mailErr.message);
        emailStatus = { error: mailErr.message };
      }
    } else {
      console.warn('Patient email not provided; skipping email notification');
      emailStatus = { skipped: true, reason: 'No patient email' };
    }

    res.json({ 
      success: true,
      appointment, 
      event,
      emailStatus
    });

  } catch (err) {
    console.error("Appointment booking error:", err);
    res.status(500).json({ error: err.message || err.toString() });
  }
});

// ----------------------
// OTHER ROUTES
// ----------------------
router.get('/appointments/patient/:patientId', async (req, res) => {
  res.json(await Appointment.find({ patientId: req.params.patientId }));
});

router.get('/calendars', async (req, res) => {
  res.json(await listCalendars());
});

// ----------------------
module.exports = router;

// ---------------------------------------------------------
// GET ALL APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find({}).sort({ startDateTime: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get available time slots for a doctor on a specific date
router.post('/doctors/:doctorId/available-slots', async (req, res) => {
  try {
    const { date } = req.body; // Expected format: "2025-11-28"
    
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });

    // Define working hours
    const workingHours = {
      start: 9, // 9 AM
      end: 17,  // 5 PM
      slotDuration: 60 // 60 minutes per slot
    };

    // Get busy times from Google Calendar
    const startOfDay = `${date}T00:00:00+05:30`;
    const endOfDay = `${date}T23:59:59+05:30`;
    
    const freeBusy = await getFreeBusy(doctor.calendarId, startOfDay, endOfDay);
    const busySlots = freeBusy.calendars[doctor.calendarId]?.busy || [];

    // Generate all possible slots
    const availableSlots = [];
    for (let hour = workingHours.start; hour < workingHours.end; hour++) {
      const slotStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00+05:30`);
      const slotEnd = new Date(slotStart.getTime() + workingHours.slotDuration * 60000);

      // Check if slot overlaps with any busy time
      const isAvailable = !busySlots.some(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return (slotStart < busyEnd && slotEnd > busyStart);
      });

      if (isAvailable) {
        const timeStr = slotStart.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });
        availableSlots.push(timeStr);
      }
    }

    res.json({ 
      success: true, 
      date, 
      slots: availableSlots 
    });

  } catch (err) {
    console.error("Error fetching available slots:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET ONE APPOINTMENT BY ID
// ---------------------------------------------------------
router.get('/appointments/:appointmentId', async (req, res) => {
  try {
    const ap = await Appointment.findOne({ appointmentId: req.params.appointmentId });
    if (!ap) return res.status(404).json({ error: "Appointment not found" });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET APPOINTMENTS FOR A DOCTOR
// ---------------------------------------------------------
router.get('/appointments/doctor/:doctorId', async (req, res) => {
  try {
    const ap = await Appointment.find({ doctorId: req.params.doctorId }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET TODAY'S APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments-today', async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const ap = await Appointment.find({ date: today }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET UPCOMING APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments-upcoming', async (req, res) => {
  try {
    const now = new Date();
    const ap = await Appointment.find({ startDateTime: { $gte: now } }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD FOR DOCTORS
// ---------------------------------------------------------
router.get('/doctor/:doctorId', async (req, res) => {
  const doc = await Doctor.findOne({ doctorId: req.params.doctorId });
  if (!doc) return res.status(404).json({ error: "Doctor not found" });
  res.json(doc);
});

router.put('/doctor/:doctorId', requireApiKey, async (req, res) => {
  try {
    const updated = await Doctor.findOneAndUpdate(
      { doctorId: req.params.doctorId },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Doctor not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/doctor/:doctorId', requireApiKey, async (req, res) => {
  try {
    const deleted = await Doctor.findOneAndDelete({ doctorId: req.params.doctorId });
    if (!deleted) return res.status(404).json({ error: "Doctor not found" });
    res.json({ success: true, doctorId: req.params.doctorId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD FOR PATIENTS
// ---------------------------------------------------------
router.get('/patient/:patientId', async (req, res) => {
  const p = await Patient.findOne({ patientId: req.params.patientId });
  if (!p) return res.status(404).json({ error: "Patient not found" });
  res.json(p);
});

router.put('/patient/:patientId', async (req, res) => {
  try {
    const updated = await Patient.findOneAndUpdate(
      { patientId: req.params.patientId },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Patient not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/patient/:patientId', async (req, res) => {
  try {
    const deleted = await Patient.findOneAndDelete({ patientId: req.params.patientId });
    if (!deleted) return res.status(404).json({ error: "Patient not found" });

    res.json({ success: true, patientId: req.params.patientId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// DELETE / CANCEL APPOINTMENT
// ---------------------------------------------------------
router.delete('/appointments/:appointmentId', requireApiKey, async (req, res) => {
  try {
    const deleted = await Appointment.findOneAndDelete({ appointmentId: req.params.appointmentId });
    if (!deleted) return res.status(404).json({ error: "Appointment not found" });

    res.json({ success: true, appointmentId: req.params.appointmentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET ALL APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find({}).sort({ startDateTime: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET ONE APPOINTMENT BY ID
// ---------------------------------------------------------
router.get('/appointments/:appointmentId', async (req, res) => {
  try {
    const ap = await Appointment.findOne({ appointmentId: req.params.appointmentId });
    if (!ap) return res.status(404).json({ error: "Appointment not found" });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET APPOINTMENTS FOR A DOCTOR
// ---------------------------------------------------------
router.get('/appointments/doctor/:doctorId', async (req, res) => {
  try {
    const ap = await Appointment.find({ doctorId: req.params.doctorId }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET TODAY'S APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments-today', async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const ap = await Appointment.find({ date: today }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET UPCOMING APPOINTMENTS
// ---------------------------------------------------------
router.get('/appointments-upcoming', async (req, res) => {
  try {
    const now = new Date();
    const ap = await Appointment.find({ startDateTime: { $gte: now } }).sort({ startDateTime: 1 });
    res.json(ap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD FOR DOCTORS
// ---------------------------------------------------------
router.get('/doctor/:doctorId', async (req, res) => {
  const doc = await Doctor.findOne({ doctorId: req.params.doctorId });
  if (!doc) return res.status(404).json({ error: "Doctor not found" });
  res.json(doc);
});

router.put('/doctor/:doctorId', requireApiKey, async (req, res) => {
  try {
    const updated = await Doctor.findOneAndUpdate(
      { doctorId: req.params.doctorId },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Doctor not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/doctor/:doctorId', requireApiKey, async (req, res) => {
  try {
    const deleted = await Doctor.findOneAndDelete({ doctorId: req.params.doctorId });
    if (!deleted) return res.status(404).json({ error: "Doctor not found" });
    res.json({ success: true, doctorId: req.params.doctorId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CRUD FOR PATIENTS
// ---------------------------------------------------------
router.get('/patient/:patientId', async (req, res) => {
  const p = await Patient.findOne({ patientId: req.params.patientId });
  if (!p) return res.status(404).json({ error: "Patient not found" });
  res.json(p);
});

router.put('/patient/:patientId', async (req, res) => {
  try {
    const updated = await Patient.findOneAndUpdate(
      { patientId: req.params.patientId },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Patient not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patients', async (req, res) => {
  const patients = await Patient.find({}).sort({ name: 1 });
  res.json(patients);
});

router.delete('/patient/:patientId', async (req, res) => {
  try {
    const deleted = await Patient.findOneAndDelete({ patientId: req.params.patientId });
    if (!deleted) return res.status(404).json({ error: "Patient not found" });

    res.json({ success: true, patientId: req.params.patientId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// DELETE / CANCEL APPOINTMENT
// ---------------------------------------------------------
router.delete('/appointments/:appointmentId', requireApiKey, async (req, res) => {
  try {
    const deleted = await Appointment.findOneAndDelete({ appointmentId: req.params.appointmentId });
    if (!deleted) return res.status(404).json({ error: "Appointment not found" });

    res.json({ success: true, appointmentId: req.params.appointmentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;

// // ========================================
// // TWILIO SMS WEBHOOK
// // ========================================
// const twilio = require('twilio');
// router.use(express.urlencoded({ extended: false }));

// router.post('/twilio-webhook', (req, res) => {
//   const incomingMsg = req.body.Body;
//   const from = req.body.From;

//   console.log("📩 SMS Received from:", from);
//   console.log("Message:", incomingMsg);

//   const twiml = new twilio.twiml.MessagingResponse();
//   twiml.message(`Thanks for messaging Medicare! You said: "${incomingMsg}".`);

//   res.writeHead(200, { 'Content-Type': 'text/xml' });
//   res.end(twiml.toString());
// });


