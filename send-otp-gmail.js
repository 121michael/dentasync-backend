const nodemailer = require('nodemailer');
require('dotenv').config();

// 1. Configure Gmail Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 2. Generate random 6-digit OTP
const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

// 3. Send Test Email
async function main() {
  try {
    const info = await transporter.sendMail({
      from: `"DentaSync" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Sends a test email to yourself
      subject: 'DentaSync OTP Test',
      html: `<h2>Your OTP Code is: <b>${otpCode}</b></h2>`,
    });

    console.log('✅ Success! Test email sent.');
    console.log('Message ID:', info.messageId);
    console.log('Generated OTP:', otpCode);
  } catch (error) {
    console.error('❌ Email failed to send:', error);
  }
}

main();