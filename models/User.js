//Backend/models/User.js
import mongoose from "mongoose";

const additionalAccessSchema = new mongoose.Schema(
  {
    floor:      { type: String, required: true },
    officeRoom: { type: String, required: true },
    canControl: { type: Boolean, default: false },
  },
  { _id: false } // no extra _id per entry
);

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  phone:     { type: String, required: true, unique: true },
  mail:      { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ["Admin", "Staff"], required: true },
  functionalGrade: {
    type: String,
    required: function () { return this.role === 'Staff'; },
    default: null,
  },
  floor:      { type: String, default: null }, // primary room
  officeRoom: { type: String, default: null }, // primary room
  additionalAccess: { type: [additionalAccessSchema], default: [] },

  avatarColor: { type: String, default: "#8B5CF6" },
  avatarImage: { type: String, default: null },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  isOnline: { type: Boolean, default: false },
  lastSeen:  { type: Date,    default: null },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
export default User;