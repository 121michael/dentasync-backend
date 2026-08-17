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

// 2. Send a delivery-only test email. Authentication codes must be generated
// and persisted by the API, never by a standalone mail script.
async function main() {
  try {
    const info = await transporter.sendMail({
      from: `"DentaSync" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Sends a test email to yourself
      subject: "DentaSync Email Delivery Test",
      html: `
        <h2>Email delivery is configured.</h2>
        <p>
          Request verification codes through the DentaSync API so the code sent
          by email is stored with its OTP request.
        </p>
      `,
    });

    console.log('✅ Success! Test email sent.');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Email failed to send:', error);
  }
}

main();