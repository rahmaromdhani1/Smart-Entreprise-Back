// Routes/users.js
import express from "express";
import { 
  updateProfile, 
  updatePassword, 
  getUserProfile 
} from "../Controllers/userController.js";
import { authenticateToken } from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.put(
  "/update-profile",
  authenticateToken,        
  upload.single("avatar"),  
  updateProfile             
);


router.put(
  "/update-password",
  authenticateToken,
  updatePassword
);

router.post("/upload-avatar/:userId", upload.single("avatar"), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Stocke le chemin relatif dans la DB
    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await user.save();

    res.json({ message: "Avatar uploaded successfully", avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/profile/:userId", authenticateToken, getUserProfile);

export default router;