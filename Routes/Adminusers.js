import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

const HEARTBEAT_TIMEOUT_MS = 65 * 1000;

const getPresenceStatus = (isOnline, lastSeen) => {
  if (!isOnline || !lastSeen) return 'offline';
  const elapsed = Date.now() - new Date(lastSeen).getTime();
  return elapsed < HEARTBEAT_TIMEOUT_MS ? 'online' : 'offline';
};

const formatLastSeen = (isOnline, lastSeen) => {
  if (!lastSeen) return 'Never';
  const elapsed = Date.now() - new Date(lastSeen).getTime();
  if (isOnline && elapsed < HEARTBEAT_TIMEOUT_MS) return 'Active now';
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60)    return `${seconds}s ago`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(lastSeen).toLocaleDateString();
};

const transformUser = (user) => {
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  return {
    id:               user._id,
    name:             `${user.firstName} ${user.lastName}`,
    initials,
    email:            user.mail,
    role:             user.role.toLowerCase(),
    functionalGrade:  user.functionalGrade,
    floor:            user.floor,
    officeRoom:       user.officeRoom,
    additionalAccess: user.additionalAccess ?? [],
    status:           getPresenceStatus(user.isOnline, user.lastSeen),
    lastLogin:        formatLastSeen(user.isOnline, user.lastSeen),
    avatarColor:      user.avatarColor,
    avatarImage:      user.avatarImage,
  };
};

// ─── Heartbeat ────────────────────────────────────────────────────────────────
router.post("/heartbeat", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const wasOnline = user.isOnline;

    await User.findByIdAndUpdate(req.user.id, {
      lastSeen: new Date(),
      isOnline: true,
    });

    // Émet seulement si le statut change (offline → online)
    if (!wasOnline) {
      req.app.get('io').emit('user:statusChange', {
        userId: String(req.user.id),
        status: 'online',
        lastLogin: 'Active now',
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Heartbeat failed" });
  }
});

// ─── Mark offline ─────────────────────────────────────────────────────────────
router.post("/offline", authenticateToken, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { isOnline: false, lastSeen: new Date() },
      { new: true }
    );

    if (user) {
      req.app.get('io').emit('user:statusChange', {
        userId: String(req.user.id),
        status: 'offline',
        lastLogin: formatLastSeen(false, user.lastSeen),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Could not mark offline" });
  }
});

// ─── Grades / Floors / Rooms ──────────────────────────────────────────────────
router.get("/grades", authenticateToken, async (req, res) => {
  try {
    const grades = await User.distinct("functionalGrade", { functionalGrade: { $ne: null } });
    res.json(grades);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch grades", error: err.message });
  }
});

router.get("/floors", authenticateToken, async (req, res) => {
  try {
    const primary    = await User.distinct("floor", { floor: { $nin: [null, ""] } });
    const additional = await User.distinct("additionalAccess.floor", { "additionalAccess.floor": { $nin: [null, ""] } });
    res.json([...new Set([...primary, ...additional])].sort());
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch floors", error: err.message });
  }
});

router.get("/rooms", authenticateToken, async (req, res) => {
  try {
    const primary    = await User.distinct("officeRoom", { officeRoom: { $nin: [null, ""] } });
    const additional = await User.distinct("additionalAccess.officeRoom", { "additionalAccess.officeRoom": { $nin: [null, ""] } });
    res.json([...new Set([...primary, ...additional])].sort());
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch rooms", error: err.message });
  }
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users.map(transformUser));
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
});

// ─── POST /api/users ──────────────────────────────────────────────────────────
router.post("/", authenticateToken, async (req, res) => {
  const {
    firstName, lastName, email, phone, password, role,
    functionalGrade, floor, officeRoom, additionalAccess,
  } = req.body;

  try {
    if (!firstName || !lastName || !email || !phone || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ $or: [{ mail: email }, { phone }] });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email or phone already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const cleanAccess = Array.isArray(additionalAccess)
      ? additionalAccess.filter(a => a.floor && a.officeRoom).map(a => ({
          floor:      a.floor.trim(),
          officeRoom: a.officeRoom.trim(),
          canControl: Boolean(a.canControl),
        }))
      : [];

    const newUser = new User({
      firstName, lastName,
      mail:  email,
      phone,
      password: hashedPassword,
      role: role.charAt(0).toUpperCase() + role.slice(1).toLowerCase(),
      functionalGrade: functionalGrade || null,
      floor:           floor      || null,
      officeRoom:      officeRoom || null,
      additionalAccess: cleanAccess,
      avatarColor: "#8B5CF6",
    });

    await newUser.save();
    res.status(201).json(transformUser(newUser));
  } catch (err) {
    res.status(500).json({ message: "Failed to create user", error: err.message });
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const {
    firstName, lastName, email, phone, password, role,
    functionalGrade, floor, officeRoom, additionalAccess,
  } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (firstName)  user.firstName = firstName;
    if (lastName)   user.lastName  = lastName;
    if (email)      user.mail      = email;
    if (phone)      user.phone     = phone;
    if (role)       user.role      = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
    if (functionalGrade !== undefined) user.functionalGrade = functionalGrade;
    if (floor       !== undefined)     user.floor           = floor      || null;
    if (officeRoom  !== undefined)     user.officeRoom      = officeRoom || null;

    if (additionalAccess !== undefined) {
      user.additionalAccess = Array.isArray(additionalAccess)
        ? additionalAccess.filter(a => a.floor && a.officeRoom).map(a => ({
            floor:      a.floor.trim(),
            officeRoom: a.officeRoom.trim(),
            canControl: Boolean(a.canControl),
          }))
        : [];
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    await user.save();
    res.json(transformUser(user));
  } catch (err) {
    res.status(500).json({ message: "Failed to update user", error: err.message });
  }
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully", id: user._id });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user", error: err.message });
  }
});

export default router;