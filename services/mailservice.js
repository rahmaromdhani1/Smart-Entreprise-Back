import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Configuration du transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Vérifier la connexion au démarrage
transporter.verify((error, success) => {
  if (error) {
    console.error("❌Email configuration error:", error);
  } else {
    console.log("✅ Email service ready");
  }
});

export const sendResetPasswordEmail = async (to, resetLink) => {
  try {
    const mailOptions = {
      from: `"Support App" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: "Reset your password",
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <!-- Header -->
          <div style="background-color: #8B5CF6; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0;">🔐 password reset</h1>
          </div>

          <!-- Content -->
          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">
              Hello,
            </p>

            <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 30px;">
              You have requested a password reset.
              Click the button below to create a new password.
            </p>

            <!-- Button -->
            <div style="text-align: center; margin-bottom: 30px;">
              <a href="${resetLink}" 
                 style="display: inline-block; background-color: #8B5CF6; color: white; 
                        text-decoration: none; padding: 12px 30px; border-radius: 6px; 
                        font-weight: bold; font-size: 16px;">
                Reset my password
              </a>
            </div>

            <!-- Link as text -->
            <p style="color: #999; font-size: 12px; word-break: break-all; margin-bottom: 20px;">
              Or copy this link : <br>
              <code style="color: #666; background-color: #f0f0f0; padding: 8px; display: block; margin-top: 8px; border-radius: 4px;">
                ${resetLink}
              </code>
            </p>

            <!-- Warning -->
            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
              <p style="color: #856404; margin: 0; font-size: 13px;">
                <strong>⚠️ Important :</strong> This link expires in 15 minutes. 
                If you did not request this reset, ignore this email.
              </p>
            </div>

            <!-- Footer -->
            <p style="color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px;">
              This email was sent automatically. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent to:", to);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("❌ Email sending error:", error);
    throw error;
  }
};
export const sendPasswordChangedEmail = async (toEmail) => {
  const mailOptions = {
    from: `"Support App" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Password changed successfully",
    html: `
      <div style="font-family: Arial; padding: 20px">
        <h2>Password Updated 🔐</h2>
        <p>Your password has been changed successfully.</p>
        <p>If you did NOT make this change, please contact support immediately.</p>
        <br />
        <p style="color: #6B7280">SEMS Team</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// Exporter le transporter si besoin
export { transporter };