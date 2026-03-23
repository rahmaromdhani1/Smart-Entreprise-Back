import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

/**
 * Middleware to verify JWT token
 * Extracts token from Authorization header and validates it
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

  console.log("🔵 Auth Middleware - Headers:", {
    hasAuthHeader: !!authHeader,
    hasToken: !!token
  });

  if (!token) {
    console.error("❌ No token provided");
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified; // { id, role, ... }
    
    console.log("✅ Token verified - User ID:", req.user.id);
    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err.message);
    return res.status(403).json({ message: "Invalid or expired token." });
  }
};
/**
 * Middleware to authorize specific roles
 * @param  {...string} allowedRoles - Roles allowed to access the route
 */
export const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    console.log("🔐 Authorize Middleware - User role:", req.user?.role);
    console.log("🔐 Allowed roles:", allowedRoles);

    if (!req.user || !allowedRoles.includes(req.user.role)) {
      console.error("❌ Access denied - Role not authorized");
      return res.status(403).json({ message: "Access denied. Insufficient permissions." });
    }

    next();
  };
};