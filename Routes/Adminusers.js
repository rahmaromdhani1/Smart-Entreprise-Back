//Routes/Adminusers
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/ users
 * Fetch all users
 */
router.get("/", authenticateToken, async (req, res) => {
  console.log("🔵 GET /api/users - Fetching all users");
  
  try {
    const users = await User.find().select("-password"); // Exclude password field
    
    // Transform users to match frontend expectations
    const transformedUsers = users.map(user => {
      const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
      
      return {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        initials: initials,
        email: user.mail,
        role: user.role.toLowerCase(), // Convert "Admin"/"Staff" to "admin"/"staff"
        functionalGrade: user.functionalGrade,
        status: "active", // Hardcoded for now
        lastLogin: "Today, 09:00", // Hardcoded for now - you can add this field to User model later
        avatarColor: user.avatarColor,
        avatarImage: user.avatarImage
      };
    });
    
    console.log(`✅ Successfully fetched ${transformedUsers.length} users`);
    res.json(transformedUsers);
    
  } catch (err) {
    console.error("❌ Error fetching users:", err.message);
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
});

/**
 * POST /api/users
 * Create a new user
 */
router.post("/", authenticateToken, async (req, res) => {
  console.log("🔵 POST /api/users - Creating new user");
  console.log("📦 Request body:", req.body);
  
  const { firstName, lastName, email, phone, password, role, functionalGrade } = req.body;

  try {
    // Validation
    if (!firstName || !lastName || !email || !phone || !password || !role) {
      return res.status(400).json({ 
        message: "All fields are required (firstName, lastName, email, phone, password, role)" 
      });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ mail: email }, { phone: phone }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        message: "User with this email or phone already exists" 
      });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      mail: email,
      phone,
      password: hashedPassword,
      role: role.charAt(0).toUpperCase() + role.slice(1).toLowerCase(), // Capitalize first letter
      functionalGrade: functionalGrade || null,
      avatarColor: "#8B5CF6" // Default color
    });
    
    await newUser.save();
    
    // Return transformed user (excluding password)
    const initials = `${newUser.firstName.charAt(0)}${newUser.lastName.charAt(0)}`.toUpperCase();
    const transformedUser = {
      id: newUser._id,
      name: `${newUser.firstName} ${newUser.lastName}`,
      initials: initials,
      email: newUser.mail,
      role: newUser.role.toLowerCase(),
      functionalGrade: newUser.functionalGrade,
      status: "active",
      lastLogin: "Just now",
      avatarColor: newUser.avatarColor,
      avatarImage: newUser.avatarImage
    };
    
    console.log("✅ User created successfully:", transformedUser.email);
    res.status(201).json(transformedUser);
    
  } catch (err) {
    console.error("❌ Error creating user:", err.message);
    res.status(500).json({ message: "Failed to create user", error: err.message });
  }
});

/**
 * PUT /api/users/:id
 * Update an existing user
 */
router.put("/:id", authenticateToken, async (req, res) => {
  console.log(`🔵 PUT /api/users/${req.params.id} - Updating user`);
  console.log("📦 Request body:", req.body);
  
  const { id } = req.params;
  const { firstName, lastName, email, phone, password, role, functionalGrade } = req.body;
  
  try {
    // Find user
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Update fields if provided
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email) user.mail = email;
    if (phone) user.phone = phone;
    if (role) user.role = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
    if (functionalGrade !== undefined) user.functionalGrade = functionalGrade;

    // Update password if provided
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }
    
    await user.save();
    
    // Return transformed user
    const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
    const transformedUser = {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      initials: initials,
      email: user.mail,
      role: user.role.toLowerCase(),
      functionalGrade: user.functionalGrade,
      status: "active",
      lastLogin: "Just now",
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage
    };
    
    console.log("✅ User updated successfully:", transformedUser.email);
    res.json(transformedUser);
    
  } catch (err) {
    console.error("❌ Error updating user:", err.message);
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

/**
 * DELETE /api/ users/:id
 * Delete a user
 */
router.delete("/:id", authenticateToken, async (req, res) => {
  console.log(`🔵 DELETE /api/users/${req.params.id} - Deleting user`);
  
  const { id } = req.params;
  
  try {
    const user = await User.findByIdAndDelete(id);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    console.log("✅ User deleted successfully:", user.mail);
    res.json({ message: "User deleted successfully", id: user._id });
    
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.status(500).json({ message: "Failed to delete user", error: err.message });
  }
});

export default router;