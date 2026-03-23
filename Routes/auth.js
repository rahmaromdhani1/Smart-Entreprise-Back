import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";
import { authenticateToken, authorizeRole } from "../middleware/auth.js";
import { sendResetPasswordEmail } from "../services/mailservice.js";

dotenv.config();
const router = express.Router();

router.get(
  "/admin/dashboard",
  authenticateToken,
  authorizeRole("Admin"),
  (req, res) => {
    res.json({ message: "Welcome Admin" });
  }
);

router.get(
  "/staff/dashboard",
  authenticateToken,
  authorizeRole("Staff"),
  (req, res) => {
    res.json({ message: "Welcome Staff" });
  }
);

// ========== LOGIN ==========
router.post("/login", async (req, res) => {
  try {
    const { mail, password, selectedRole } = req.body;

    if (!mail || !password || !selectedRole) {
      return res.status(400).json({
        success: false,
        message: "Email, password and role required",
      });
    }

    const user = await User.findOne({ mail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🔥 Vérification du rôle
    if (user.role.toLowerCase() !== selectedRole.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Invalid role selected for this account",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Incorrect password",
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      success: true,
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      mail: user.mail,
      role: user.role,
      avatarColor: user.avatarColor || "#8B5CF6",
      avatarImage: user.avatarImage || null,
      token,
    });

  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


// In routes/auth.js - FORGOT PASSWORD route

router.post("/forgot-password", async (req, res) => {
  try {
    const { mail } = req.body;

    if (!mail) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(mail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const user = await User.findOne({ mail: mail.toLowerCase() });

    if (!user) {
      return res.json({
        success: true,
        message: "If this account exists, a reset email has been sent.",
      });
    }

    // Generate random token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash the token
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Token valid for 15 minutes
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;

    await user.save();
    const clientUrl = req.body.platform === "mobile"
  ? process.env.CLIENT_URL_MOBILE
  : process.env.CLIENT_URL_WEB;
    // ✅ CHANGED: Use query parameter instead of path parameter
    const resetLink = `${clientUrl}/reset-password?token=${resetToken}`;
    
    console.log('📧 Reset link generated:', resetLink);

    // Send email
    try {
      await sendResetPasswordEmail(user.mail, resetLink);
      console.log('✅ Reset email sent to:', user.mail);
    } catch (emailError) {
      console.error("❌ Email sending error:", emailError);
    }

    res.json({
      success: true,
      message: "If this account exists, a reset email has been sent.",
    });
  } catch (err) {
    console.error("❌ Erreur forgot-password:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ========== VERIFY RESET TOKEN (CRUCIAL POUR MOBILE!) ==========
router.post("/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.body; // ✅ Changed from req.params to req.body

    if (!token) {
      return res.status(400).json({
        valid: false, // ✅ Changed from success to valid
        message: "Token required",
      });
    }

    console.log('🔍 Backend: Verifying token:', token);

    // ✅ Hash the token to match database
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    console.log('🔑 Backend: Hashed token:', hashedToken);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      console.log('❌ Backend: Token not found or expired');
      return res.status(400).json({
        valid: false, // ✅ Changed from success to valid
        message: "Invalid or expired token",
      });
    }

    console.log('✅ Backend: Token is valid for user:', user.mail);

    res.json({
      valid: true, // ✅ Changed from success to valid
      message: "Valid token",
      email: user.mail,
    });
  } catch (err) {
    console.error("❌ Backend error verify-reset-token:", err);
    res.status(500).json({
      valid: false,
      message: "Server error",
    });
  }
});

// ========== RESET PASSWORD (UPDATE TO SUPPORT BODY TOKEN) ==========
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body; // ✅ Get token from body

    // Validations
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token required",
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Both passwords are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "The passwords do not match",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Minimum 8 characters required",
      });
    }

    console.log('🔐 Backend: Resetting password with token:', token);

    // ✅ Hash the token to match database
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      console.log('❌ Backend: Invalid or expired token');
      return res.status(400).json({
        success: false,
        message: "Invalid or expired link",
      });
    }

    // Hash and save new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    console.log('✅ Backend: Password reset successful for:', user.mail);
                
    res.json({
      success: true,
      message: "Password successfully reset",
    });
  } catch (err) {
    console.error("❌ Backend error reset-password:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;