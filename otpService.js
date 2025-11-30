const crypto = require('crypto');
const nodemailer = require('nodemailer');

// In-memory OTP storage (for production, use Redis or database)
const otpStore = new Map();

// OTP configuration
const OTP_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
const OTP_LENGTH = 6;

/**
 * Generate a random OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999). toString();
}

/**
 * Store OTP with expiry
 */
function storeOTP(email, otp) {
  const expiryTime = Date.now() + OTP_EXPIRY_TIME;
  otpStore. set(email, {
    otp,
    expiryTime,
    attempts: 0
  });
  
  console.log(`✅ OTP generated for ${email}: ${otp} (Expires in 5 minutes)`);
  
  // Auto-cleanup expired OTP after 5 minutes
  setTimeout(() => {
    if (otpStore.has(email)) {
      otpStore.delete(email);
      console.log(`🗑️ OTP expired and removed for ${email}`);
    }
  }, OTP_EXPIRY_TIME);
}

/**
 * Verify OTP
 */
function verifyOTP(email, otp) {
  if (!otpStore.has(email)) {
    return {
      valid: false,
      message: "OTP not found or expired. Please request a new OTP.",
      remainingAttempts: 0
    };
  }
  
  const storedData = otpStore.get(email);
  
  // Check if OTP has expired
  if (Date.now() > storedData.expiryTime) {
    otpStore.delete(email);
    return {
      valid: false,
      message: "OTP has expired. Please request a new OTP.",
      remainingAttempts: 0
    };
  }
  
  // Check maximum attempts (5 attempts max)
  if (storedData.attempts >= 5) {
    otpStore.delete(email);
    return {
      valid: false,
      message: "Maximum OTP verification attempts exceeded. Please request a new OTP.",
      remainingAttempts: 0
    };
  }
  
  // Check if OTP matches
  if (storedData.otp !== otp.toString()) {
    storedData.attempts += 1;
    const remaining = 5 - storedData.attempts;
    return {
      valid: false,
      message: `Invalid OTP`,
      remainingAttempts: remaining
    };
  }
  
  // OTP is valid - remove it from store
  otpStore.delete(email);
  return {
    valid: true,
    message: "OTP verified successfully",
    remainingAttempts: null
  };
}
/**
 * Send OTP via email
 */
async function sendOTPEmail(transporter, email, otp, patientName) {
  try {
    const mailOptions = {
      from: process.env.FROM_EMAIL || process.env. SMTP_USER,
      to: email,
      subject: '🔐 Your OTP for Registration - Healthcare Plus',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0;">🔐 OTP Verification</h1>
          </div>
          
          <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
            <p style="font-size: 16px;">Hello <strong>${patientName}</strong>,</p>
            
            <p>Thank you for registering with Healthcare Plus.  To complete your registration, please verify your email address using the OTP below:</p>
            
            <div style="background-color: #f0f0f0; padding: 25px; border-radius: 8px; margin: 30px 0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #666;">Your One-Time Password (OTP) is:</p>
              <h2 style="margin: 20px 0 0 0; font-size: 48px; letter-spacing: 5px; color: #4CAF50; font-weight: bold;">${otp}</h2>
              <p style="margin: 15px 0 0 0; font-size: 12px; color: #999;">This OTP will expire in 5 minutes</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0;"><strong>⚠️ Important Security Notes:</strong></p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; font-size: 14px;">
                <li>Never share this OTP with anyone</li>
                <li>Healthcare Plus staff will never ask for your OTP</li>
                <li>OTP is valid for only 5 minutes</li>
                <li>Maximum 5 verification attempts allowed</li>
              </ul>
            </div>
            
            <p style="font-size: 14px; color: #666; margin-top: 25px;">If you didn't request this registration, please ignore this email.</p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
            
            <p style="color: #666; font-size: 12px; text-align: center; margin: 0;">
              This is an automated message from Healthcare Plus. <br>
              For any queries, please contact: support@hospital.com<br>
              <br>
              © 2025 Healthcare Plus. All rights reserved. 
            </p>
          </div>
        </div>
      `,
      text: `
Healthcare Plus - OTP Verification

Hello ${patientName},

Thank you for registering with Healthcare Plus. Please use the OTP below to verify your email address:

OTP: ${otp}

This OTP will expire in 5 minutes. 

IMPORTANT SECURITY NOTES:
- Never share this OTP with anyone
- Healthcare Plus staff will never ask for your OTP
- Maximum 5 verification attempts allowed

If you didn't request this registration, please ignore this email.

---
This is an automated message from Healthcare Plus. 
For any queries, contact: support@hospital.com

© 2025 Healthcare Plus. All rights reserved.
      `
    };
    
    const info = await transporter.sendMail(mailOptions);
    console. log('✅ OTP email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('❌ Error sending OTP email:', error);
    throw error;
  }
}

/**
 * Get OTP status (for debugging/monitoring)
 */
function getOTPStatus(email) {
  if (!otpStore.has(email)) {
    return null;
  }
  
  const data = otpStore.get(email);
  const remainingTime = Math.max(0, Math.ceil((data.expiryTime - Date. now()) / 1000));
  
  return {
    exists: true,
    remainingTime,
    attempts: data.attempts,
    maxAttempts: 5
  };
}

module.exports = {
  generateOTP,
  storeOTP,
  verifyOTP,
  sendOTPEmail,
  getOTPStatus
};
