const { sendEmailOtp, emailDeliveryIsConfigured, getMailConfig } = require("./services/emailDelivery");
require("dotenv").config();

async function main() {
  if (!emailDeliveryIsConfigured()) {
    console.error(
      "Email delivery is not configured. Set EMAIL_USER and EMAIL_PASS, or GMAIL_APPS_SCRIPT_URL and GMAIL_APPS_SCRIPT_SECRET."
    );
    process.exitCode = 1;
    return;
  }

  try {
    const mail = getMailConfig();
    await sendEmailOtp({
      to: mail.user || process.env.EMAIL_USER,
      otp: "000000",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    console.log("✅ Success! Delivery test email sent.");
    console.log(
      "Request verification codes through the DentaSync API so the code sent by email is stored with its OTP request."
    );
  } catch (error) {
    console.error("❌ Email failed to send:", error);
    process.exitCode = 1;
  }
}

main();
