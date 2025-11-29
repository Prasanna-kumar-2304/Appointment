const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const Doctor = require('./Doctor');
const Patient = require('./Patient');
const Appointment = require('./appointment');

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
// ========================================
// ENHANCED API ENDPOINTS FOR CHATBOT
// Add these to your existing api.js file
// ========================================

// ========================================
// 1. GET DOCTORS BY SPECIALTY
// ========================================
router.get('/doctors/specialty/:specialty', async (req, res) => {
  try {
    const specialty = req.params.specialty;
    
    // Case-insensitive search
    const doctors = await Doctor.find({ 
      specialty: new RegExp(`^${specialty}$`, 'i')
    }).select('doctorId name specialty qualification experience rating consultationFee');
    
    if (doctors.length === 0) {
      return res.status(404).json({ 
        error: "No doctors found for this specialty",
        specialty: specialty
      });
    }
    
    res.json({
      specialty: specialty,
      count: doctors.length,
      doctors: doctors
    });
    
  } catch (err) {
    console.error('Error fetching doctors by specialty:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// 2. GET ALL SPECIALTIES
// ========================================
router.get('/specialties', async (req, res) => {
  try {
    const specialties = await Doctor.distinct('specialty');
    res.json({
      count: specialties.length,
      specialties: specialties.sort()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// 3. GET DOCTOR AVAILABILITY FOR A DATE
// ========================================
router.post('/doctors/:doctorId/availability', async (req, res) => {
  try {
    const { date } = req.body; // Format: "2025-11-28"
    
    if (!date) {
      return res.status(400).json({ error: "Date is required" });
    }
    
    const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
    
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }
    
    // Debug log
    console.log('Doctor found:', doctor.doctorId);
    console.log('Raw availability:', doctor.availability);
    
    // Get day of week
    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    
    console.log('Date:', date);
    console.log('Day of week:', dayOfWeek);
    
    // Check if availability exists and is properly structured
    if (!doctor.availability) {
      console.error('Doctor availability is null/undefined');
      return res.status(500).json({
        error: "Doctor availability not configured",
        message: "Please contact administrator to configure doctor availability",
        doctorId: doctor.doctorId
      });
    }
    
    // Convert Mongoose document to plain object
    let availability;
    try {
      availability = doctor.availability.toObject ? 
                    doctor.availability.toObject() : 
                    JSON.parse(JSON.stringify(doctor.availability));
    } catch (conversionError) {
      console.error('Error converting availability:', conversionError);
      availability = doctor.availability;
    }
    
    console.log('Converted availability:', JSON.stringify(availability, null, 2));
    
    // Validate availability structure
    if (typeof availability !== 'object') {
      console.error('Availability is not an object:', typeof availability);
      return res.status(500).json({
        error: "Invalid availability structure",
        message: "Doctor availability data is corrupted",
        doctorId: doctor.doctorId
      });
    }
    
    // Check if the specific day exists
    if (!availability[dayOfWeek]) {
      console.error(`No availability data for ${dayOfWeek}`);
      return res.json({
        date,
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        availableSlots: [],
        message: `No availability configuration for ${dayOfWeek}`
      });
    }
    
    const dayAvailability = availability[dayOfWeek];
    
    // Validate day availability structure
    if (typeof dayAvailability !== 'object' || 
        !dayAvailability.hasOwnProperty('available') ||
        !dayAvailability.hasOwnProperty('start') ||
        !dayAvailability.hasOwnProperty('end')) {
      console.error('Invalid day availability structure:', dayAvailability);
      return res.status(500).json({
        error: "Invalid day availability structure",
        message: `Availability data for ${dayOfWeek} is incomplete`,
        doctorId: doctor.doctorId
      });
    }
    
    // Check if doctor is available on this day
    if (!dayAvailability.available) {
      return res.json({
        date,
        doctorId: doctor.doctorId,
        doctorName: doctor.name,
        availableSlots: [],
        message: "Doctor not available on this day"
      });
    }
    
    // Validate start and end times
    if (!dayAvailability.start || !dayAvailability.end) {
      console.error('Missing start or end time:', dayAvailability);
      return res.status(500).json({
        error: "Invalid working hours",
        message: "Doctor working hours not properly configured",
        doctorId: doctor.doctorId
      });
    }
    
    // Check Google Calendar for busy times
    const timeMin = `${date}T00:00:00+05:30`;
    const timeMax = `${date}T23:59:59+05:30`;
    
    let busyPeriods = [];
    try {
      if (doctor.calendarId) {
        const freeBusy = await getFreeBusy(doctor.calendarId, timeMin, timeMax);
        busyPeriods = freeBusy.busy || [];
      }
    } catch (calErr) {
      console.warn('Calendar check failed, showing all slots:', calErr.message);
    }
    
    // Get existing appointments for this doctor on this date
    const existingAppointments = await Appointment.find({
      doctorId: doctor.doctorId,
      date: date,
      status: { $ne: 'cancelled' }
    });
    
    console.log(`Found ${existingAppointments.length} existing appointments for ${date}`);
    
    // Generate available slots
    const availableSlots = generateAvailableSlots(
      date,
      dayAvailability.start,
      dayAvailability.end,
      busyPeriods,
      existingAppointments
    );
    
    res.json({
      date,
      doctorId: doctor.doctorId,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      consultationFee: doctor.consultationFee,
      workingHours: {
        start: dayAvailability.start,
        end: dayAvailability.end
      },
      availableSlots: availableSlots,
      totalSlots: availableSlots.length
    });
    
  } catch (err) {
    console.error('Error checking availability:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : 'Internal server error'
    });
  }
});

// ========================================
// HELPER: GENERATE AVAILABLE SLOTS
// ========================================
function generateAvailableSlots(date, startTime, endTime, busyPeriods, existingAppointments) {
  const slots = [];
  
  // Parse start and end times (format: "09:00")
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  // Convert to minutes for easier calculation
  let currentMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  
  // Generate 30-minute slots
  while (currentMinutes + 30 <= endMinutes) {
    const slotHour = Math.floor(currentMinutes / 60);
    const slotMinute = currentMinutes % 60;
    
    const nextMinutes = currentMinutes + 30;
    const nextHour = Math.floor(nextMinutes / 60);
    const nextMinute = nextMinutes % 60;
    
    // Format times
    const slotStart = `${slotHour.toString().padStart(2, '0')}:${slotMinute.toString().padStart(2, '0')}`;
    const slotEnd = `${nextHour.toString().padStart(2, '0')}:${nextMinute.toString().padStart(2, '0')}`;
    
    // Create ISO datetime strings for checking conflicts
    const slotStartISO = `${date}T${slotStart}:00+05:30`;
    const slotEndISO = `${date}T${slotEnd}:00+05:30`;
    
    // Check if slot is available
    const isAvailable = !isSlotConflicting(
      slotStartISO,
      slotEndISO,
      busyPeriods,
      existingAppointments
    );
    
    if (isAvailable) {
      // Format for display
      const displayStart = formatTimeDisplay(slotHour, slotMinute);
      const displayEnd = formatTimeDisplay(nextHour, nextMinute);
      
      slots.push({
        time: `${displayStart} - ${displayEnd}`,
        startTime: slotStart,
        endTime: slotEnd,
        startISO: slotStartISO,
        endISO: slotEndISO
      });
    }
    
    currentMinutes += 30;
  }
  
  return slots;
}

// ========================================
// HELPER: FORMAT TIME FOR DISPLAY
// ========================================
function formatTimeDisplay(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  return `${displayHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${period}`;
}

// ========================================
// HELPER: CHECK SLOT CONFLICTS
// ========================================
function isSlotConflicting(slotStart, slotEnd, busyPeriods, existingAppointments) {
  const slotStartTime = new Date(slotStart).getTime();
  const slotEndTime = new Date(slotEnd).getTime();
  
  // Check against Google Calendar busy periods
  for (const busy of busyPeriods) {
    const busyStart = new Date(busy.start).getTime();
    const busyEnd = new Date(busy.end).getTime();
    
    // Check for overlap
    if (slotStartTime < busyEnd && slotEndTime > busyStart) {
      return true;
    }
  }
  
  // Check against existing appointments
  for (const appointment of existingAppointments) {
    const apptStart = new Date(appointment.startDateTime).getTime();
    const apptEnd = new Date(appointment.endDateTime).getTime();
    
    // Check for overlap
    if (slotStartTime < apptEnd && slotEndTime > apptStart) {
      return true;
    }
  }
  
  return false;
}

// ========================================
// 4. SIMPLIFIED APPOINTMENT BOOKING
// ========================================
router.post('/appointments/book', requireApiKey, async (req, res) => {
  try {
    const {
      doctorId,
      patientName,
      patientEmail,
      patientPhone,
      date,
      timeSlot, // "09:00 AM - 09:30 AM"
      reason,
      appointmentType = "In-Person"
    } = req.body;
    
    // Validate required fields
    if (!doctorId || !patientName || !date || !timeSlot) {
      return res.status(400).json({ 
        error: "Missing required fields",
        required: ["doctorId", "patientName", "date", "timeSlot"]
      });
    }
    
    if (!patientEmail && !patientPhone) {
      return res.status(400).json({ 
        error: "Either email or phone is required"
      });
    }
    
    // Get doctor details
    const doctor = await Doctor.findOne({ doctorId });
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }
    
    // Create or update patient
    let patient = await Patient.findOne({ 
      $or: [
        { email: patientEmail },
        { phone: patientPhone }
      ]
    });
    
    if (!patient) {
      patient = new Patient({
        patientId: `P-${uuidv4().slice(0, 8)}`,
        name: patientName,
        email: patientEmail,
        phone: patientPhone
      });
    } else {
      patient.name = patientName;
      if (patientEmail) patient.email = patientEmail;
      if (patientPhone) patient.phone = patientPhone;
    }
    
    await patient.save();
    
    // Parse time slot
    const timeMatch = timeSlot.match(/(\d{2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) {
      return res.status(400).json({ error: "Invalid time slot format" });
    }
    
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2];
    const period = timeMatch[3].toUpperCase();
    
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    
    const startTime = `${hour.toString().padStart(2, '0')}:${minute}:00`;
    const endHour = hour + (minute === '30' ? 1 : 0);
    const endMinute = minute === '30' ? '00' : '30';
    const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute}:00`;
    
    const startDateTimeISO = `${date}T${startTime}+05:30`;
    const endDateTimeISO = `${date}T${endTime}+05:30`;
    
    // Check if slot is still available
    const conflictingAppointment = await Appointment.findOne({
      doctorId: doctor.doctorId,
      status: { $ne: 'cancelled' },
      $or: [
        {
          startDateTime: { $lt: new Date(endDateTimeISO) },
          endDateTime: { $gt: new Date(startDateTimeISO) }
        }
      ]
    });
    
    if (conflictingAppointment) {
      return res.status(409).json({ 
        error: "This time slot is no longer available",
        message: "Please select a different time"
      });
    }
    
    // Build description
    const { plain, html } = buildDescriptionPayload({
      patient,
      doctor,
      reason,
      appointmentType,
      paymentStatus: 'pending',
      doctorInstructions: '',
      attachmentUrl: null
    });
    
    // Create Google Calendar event
    const eventObj = {
      summary: `Consultation - ${doctor.name}`,
      description: plain,
      start: { 
        dateTime: startDateTimeISO, 
        timeZone: doctor.timezone || 'Asia/Kolkata' 
      },
      end: { 
        dateTime: endDateTimeISO, 
        timeZone: doctor.timezone || 'Asia/Kolkata' 
      },
      attendees: [
        ...(doctor.email ? [{ email: doctor.email }] : []),
        ...(patient.email ? [{ email: patient.email }] : [])
      ]
    };
    
    let googleEvent;
    try {
      googleEvent = await createEvent(doctor.calendarId, eventObj);
    } catch (calErr) {
      console.error('Google Calendar error:', calErr);
      // Continue without calendar event
      googleEvent = { id: 'manual-' + Date.now() };
    }
    
    // Create appointment
    const appointment = new Appointment({
      appointmentId: `A-${uuidv4().slice(0, 8)}`,
      doctorId: doctor.doctorId,
      patientId: patient.patientId,
      date: date,
      startDateTime: new Date(startDateTimeISO),
      endDateTime: new Date(endDateTimeISO),
      googleEventId: googleEvent.id,
      status: 'confirmed',
      paymentStatus: 'pending',
      reason: reason || 'General consultation'
    });
    
    await appointment.save();
    
    // Send confirmation email
    let emailStatus = null;
    if (patient.email) {
      try {
        emailStatus = await sendConfirmationEmail({
          toEmail: patient.email,
          subject: `Appointment Confirmed: ${doctor.name} on ${date}`,
          htmlBody: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
              <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="margin: 0;">✓ Appointment Confirmed</h1>
              </div>
              
              <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <p style="font-size: 16px;">Dear <strong>${patient.name}</strong>,</p>
                
                <p>Your appointment has been successfully confirmed!</p>
                
                <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="margin-top: 0; color: #333;">Appointment Details</h3>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0;"><strong>Doctor:</strong></td>
                      <td style="padding: 8px 0;">${doctor.name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0;"><strong>Specialty:</strong></td>
                      <td style="padding: 8px 0;">${doctor.specialty}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0;"><strong>Date:</strong></td>
                      <td style="padding: 8px 0;">${date}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0;"><strong>Time:</strong></td>
                      <td style="padding: 8px 0;">${timeSlot}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0;"><strong>Appointment ID:</strong></td>
                      <td style="padding: 8px 0;">${appointment.appointmentId}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0;"><strong>Consultation Fee:</strong></td>
                      <td style="padding: 8px 0;">₹${doctor.consultationFee}</td>
                    </tr>
                  </table>
                </div>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                  <p style="margin: 0;"><strong>Important Reminders:</strong></p>
                  <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                    <li>Please arrive 10 minutes before your scheduled time</li>
                    <li>Bring any relevant medical records or test results</li>
                    <li>Bring a valid ID proof</li>
                    <li>Bring your prescription if this is a follow-up visit</li>
                  </ul>
                </div>
                
                ${googleEvent.htmlLink ? `
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${googleEvent.htmlLink}" target="_blank" 
                     style="background-color: #4CAF50; color: white; padding: 12px 30px; 
                            text-decoration: none; border-radius: 5px; display: inline-block; 
                            font-weight: bold;">
                    Add to Google Calendar
                  </a>
                </div>
                ` : ''}
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
                
                <p style="color: #666; font-size: 13px; text-align: center; margin: 0;">
                  This is an automated message from Medicare AI Bot.<br>
                  For any queries, please contact: support@hospital.com<br>
                  <br>
                  Thank you for choosing our healthcare services!
                </p>
              </div>
            </div>
          `,
          textBody: `
Appointment Confirmed

Dear ${patient.name},

Your appointment has been successfully confirmed!

APPOINTMENT DETAILS:
Doctor: ${doctor.name}
Specialty: ${doctor.specialty}
Date: ${date}
Time: ${timeSlot}
Appointment ID: ${appointment.appointmentId}
Consultation Fee: ₹${doctor.consultationFee}

IMPORTANT REMINDERS:
- Please arrive 10 minutes before your scheduled time
- Bring any relevant medical records or test results
- Bring a valid ID proof
- Bring your prescription if this is a follow-up visit

${googleEvent.htmlLink ? `\nAdd to Calendar: ${googleEvent.htmlLink}` : ''}

---
This is an automated message from Medicare AI Bot.
For any queries, please contact: support@hospital.com

Thank you for choosing our healthcare services!
          `
        });
      } catch (mailErr) {
        console.error("Email send failed:", mailErr);
        emailStatus = { error: mailErr.message };
      }
    }
    
    // Return success response
    res.json({
      success: true,
      message: "Appointment booked successfully",
      appointment: {
        appointmentId: appointment.appointmentId,
        doctorName: doctor.name,
        specialty: doctor.specialty,
        date: date,
        time: timeSlot,
        patientName: patient.name,
        status: appointment.status,
        consultationFee: doctor.consultationFee
      },
      patient: {
        patientId: patient.patientId,
        name: patient.name,
        email: patient.email,
        phone: patient.phone
      },
      emailStatus,
      calendarEvent: googleEvent.htmlLink ? {
        link: googleEvent.htmlLink
      } : null
    });
    
  } catch (err) {
    console.error("Appointment booking error:", err);
    res.status(500).json({ 
      error: err.message || "Failed to book appointment",
      details: err.toString()
    });
  }
});

// ========================================
// 5. SEARCH PATIENTS (for existing patient lookup)
// ========================================
router.get('/patients/search', async (req, res) => {
  try {
    const { email, phone } = req.query;
    
    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone required" });
    }
    
    const patient = await Patient.findOne({
      $or: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : [])
      ]
    });
    
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }
    
    res.json(patient);
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// 6. CANCEL APPOINTMENT
// ========================================
router.post('/appointments/:appointmentId/cancel', requireApiKey, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ 
      appointmentId: req.params.appointmentId 
    });
    
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    
    appointment.status = 'cancelled';
    await appointment.save();
    
    // TODO: Cancel Google Calendar event
    
    res.json({
      success: true,
      message: "Appointment cancelled successfully",
      appointmentId: appointment.appointmentId
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// 7. GET PATIENT APPOINTMENTS
// ========================================
router.get('/patients/:patientId/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find({ 
      patientId: req.params.patientId 
    }).sort({ startDateTime: -1 });
    
    // Enrich with doctor details
    const enrichedAppointments = await Promise.all(
      appointments.map(async (appt) => {
        const doctor = await Doctor.findOne({ doctorId: appt.doctorId });
        return {
          ...appt.toObject(),
          doctorName: doctor ? doctor.name : 'Unknown',
          doctorSpecialty: doctor ? doctor.specialty : 'Unknown'
        };
      })
    );
    
    res.json({
      patientId: req.params.patientId,
      count: enrichedAppointments.length,
      appointments: enrichedAppointments
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Export the router
module.exports = router;
