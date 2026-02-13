// Controllers/userController.js - FIXED VERSION
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendPasswordChangedEmail } from "../services/mailservice.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const updateProfile = async (req, res) => {
  const { email, phone, avatarColor, removeAvatar } = req.body;
  const userId = req.user.id;

  try {
    console.log("🔵 updateProfile called for userId:", userId);
    console.log("🔵 Request body:", { email, phone, avatarColor, removeAvatar });
    console.log("🔵 File uploaded:", req.file ? "YES" : "NO");

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    console.log("🔵 User found in DB - BEFORE update:", {
      id: user._id,
      avatarImage: user.avatarImage,
      avatarColor: user.avatarColor
    });

    // === VALIDATION ===
    if (!email) return res.status(400).json({ message: "Email is required" });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ message: "Invalid email format" });

    if (phone) {
      const phoneRegex = /^\d{8}$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ message: "Invalid phone format. Use 8 digits" });
      }
    }

    if (avatarColor && !/^#[0-9A-Fa-f]{6}$/.test(avatarColor)) {
      return res.status(400).json({ message: "Invalid avatar color format" });
    }

    // === CHECK UNIQUENESS ===
    const existingUser = await User.findOne({ mail: email.toLowerCase().trim(), _id: { $ne: userId } });
    if (existingUser) return res.status(409).json({ message: "Email already in use" });

    if (phone) {
      const existingPhone = await User.findOne({ phone: phone.trim(), _id: { $ne: userId } });
      if (existingPhone) return res.status(409).json({ message: "Phone number already in use" });
    }

    // === HANDLE AVATAR REMOVAL ===
    if (removeAvatar === 'true' || removeAvatar === true) {
      console.log("🔵 Removing avatar image, using color only");
      
      // Delete old file if exists
      if (user.avatarImage) {
  // extraire le nom de fichier depuis l'URL
  const filename = path.basename(user.avatarImage);
  const oldFilePath = path.join(__dirname, "..", "uploads", "avatars", filename);

  if (fs.existsSync(oldFilePath)) {
    fs.unlinkSync(oldFilePath);
    console.log("✅ Deleted old avatar file:", oldFilePath);
  }
}

      
      user.avatarImage = null; // ✅ Clear the image
      user.avatarColor = avatarColor || user.avatarColor || "#8B5CF6";
    }
    // === HANDLE AVATAR FILE UPLOAD ===
    else if (req.file) {
  console.log("🔵 Processing file upload...");

  // Supprime l'ancien avatar si nécessaire
  if (user.avatarImage) {
    const oldFilePath = path.join(__dirname, "..", "uploads", "avatars", path.basename(user.avatarImage));
    if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  }

  // Stocke l'URL complète dans la DB
  const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/avatars/${req.file.filename}`;
  user.avatarImage = avatarUrl;

  console.log("🔵 Set user.avatarImage to:", user.avatarImage);
}

    // === HANDLE COLOR CHANGE ONLY (no file, no removal) ===
    else {
      console.log("🔵 No file uploaded, updating color only");
      user.avatarColor = avatarColor || user.avatarColor || "#8B5CF6";
    }

    // === UPDATE FIELDS ===
    user.mail = email.toLowerCase().trim();
    if (phone) user.phone = phone.trim();

    console.log("🔵 User object BEFORE save:", {
      id: user._id,
      mail: user.mail,
      phone: user.phone,
      avatarImage: user.avatarImage,
      avatarColor: user.avatarColor
    });

    // ✅ CRITICAL: Actually save to database
    await user.save();
    
    console.log("✅ User.save() completed");

    // ✅ Verify the save by reading from DB again
    const verifyUser = await User.findById(userId);
    console.log("🔵 User in DB AFTER save (verification):", {
      id: verifyUser._id,
      avatarImage: verifyUser.avatarImage,
      avatarColor: verifyUser.avatarColor
    });

    // === SUCCESS RESPONSE ===
    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        mail: user.mail,
        role: user.role,
        avatarColor: user.avatarColor,
        avatarImage: user.avatarImage
      }
    });

  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

export const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ 
        message: "New password must be at least 8 characters" 
      });
    }

    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
      return res.status(400).json({ 
        message: "Password must contain uppercase, lowercase, and numbers" 
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: "New password must be different from current password" 
      });
    }

    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    try {
     await sendPasswordChangedEmail(user.mail);
     console.log("✅ Password change email sent to:", user.mail);
    } catch (emailError) {
     console.error("❌ Failed to send password change email:", emailError);
    }
    res.json({ message: "Password updated successfully" });

  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      mail: user.mail,
      role: user.role,
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage
    });

  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};