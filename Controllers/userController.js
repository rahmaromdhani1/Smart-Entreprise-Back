// Controllers/userController.js 
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sendPasswordChangedEmail } from "../services/mailservice.js"; // ✅ ADDED

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Presence helpers (called from your auth controller) ─────────────────────
/**
 * Call this right after issuing a JWT on login:
 *   await markUserOnline(user._id);
 */
export const markUserOnline = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    isOnline: true,
    lastSeen: new Date(),
  });
};

/**
 * Call this in your logout handler before destroying the session/token:
 *   await markUserOffline(userId);
 *
 * isOnline → false immediately.
 * lastSeen is intentionally NOT changed so "offline since X" stays accurate.
 */
export const markUserOffline = async (userId) => {
  await User.findByIdAndUpdate(userId, { isOnline: false });
};
// ─────────────────────────────────────────────────────────────────────────────


// Controllers/userController.js

export const testPassword = async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "This endpoint is disabled in production" });
  }

  const { testPassword } = req.body;
  const userId = req.user?.id;

  try {
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!testPassword) {
      return res.status(400).json({ message: "testPassword is required" });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(testPassword, user.password);
    
    console.log("\n🔍 Password Test Results:");
    console.log("- User:", user.mail);
    console.log("- Test Password:", testPassword);
    console.log("- Result:", isMatch ? "✅ MATCH" : "❌ NO MATCH");
    console.log("- Hash (first 30 chars):", user.password.substring(0, 30) + "...");
    
    res.json({
      success: true,
      user: {
        email: user.mail,
        firstName: user.firstName,
        lastName: user.lastName
      },
      passwordTest: {
        testPassword: testPassword,
        matches: isMatch,
        message: isMatch ? "Password is correct ✅" : "Password is incorrect ❌"
      },
      hashInfo: {
        length: user.password.length,
        preview: user.password.substring(0, 30) + "...",
        algorithm: "bcrypt"
      }
    });
    
  } catch (err) {
    console.error("❌ Test password error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user?.id; // ✅ Safe access

  try {
    console.log("🔵 updatePassword called for userId:", userId);
    console.log("🔵 Request body received:", { 
      hasCurrentPassword: !!currentPassword, 
      hasNewPassword: !!newPassword 
    });

    // ✅ Verify user ID exists (from JWT)
    if (!userId) {
      console.error("❌ No userId in req.user - JWT middleware failed");
      return res.status(401).json({ message: "Authentication failed. Please login again." });
    }

    // ✅ Validate inputs
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

    // ✅ Find user
    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ User not found in database:", userId);
      return res.status(404).json({ message: "User not found" });
    }

    console.log("✅ User found:", user.mail);

    // ✅ Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      console.log("❌ Current password is incorrect");
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    console.log("✅ Current password verified");

    // ✅ Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: "New password must be different from current password" 
      });
    }

    // ✅ Hash and save new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    console.log("✅ Password updated successfully for:", user.mail);

    // ✅ SEND EMAIL NOTIFICATION (non-blocking)
    try {
      await sendPasswordChangedEmail(user.mail);
      console.log("✅ Password change notification email sent to:", user.mail);
    } catch (emailError) {
      // ⚠️ Don't fail the request if email fails - just log it
      console.error("⚠️ Failed to send password change notification email:", emailError.message);
      console.error("   (Password was still updated successfully)");
    }

    res.json({ message: "Password updated successfully" });

  } catch (err) {
    console.error("❌ Password update error:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

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
        const oldFilePath = path.join(__dirname, "..", user.avatarImage);
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
      
      const uploadsDir = path.join(__dirname, "..", "uploads");
      
      // Create uploads directory if it doesn't exist
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log("✅ Created uploads directory:", uploadsDir);
      }

      // Delete old file if exists
      if (user.avatarImage) {
        const oldFilePath = path.join(__dirname, "..", user.avatarImage);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log("✅ Deleted old avatar file:", oldFilePath);
        }
      }

      const fileName = `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
      const uploadPath = path.join(uploadsDir, fileName);
      
      console.log("🔵 Writing file to:", uploadPath);
      fs.writeFileSync(uploadPath, req.file.buffer);
      console.log("✅ File written successfully");

      user.avatarImage = `/uploads/${fileName}`;
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
    if (!user.functionalGrade) {
      console.log("⚠️ User missing functionalGrade, setting default 'Unassigned'");
      user.functionalGrade = "Unassigned";
    }

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
      functionalGrade:  user.functionalGrade  ?? null,
      floor:            user.floor            ?? null,
      officeRoom:       user.officeRoom        ?? null,
      additionalAccess: user.additionalAccess  ?? [],
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage,
    });

  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};