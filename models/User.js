
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },        
  lastName: { type: String, required: true },         
  phone: { type: String, required: true, unique: true }, 
  mail: { type: String, required: true, unique: true },  
  password: { type: String, required: true },       
  role: { type: String, enum: ["Admin", "Staff"], required: true },
  avatarColor: { type: String, default: "#8B5CF6" },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  functionalGrade: { type: String, required: true,default: null },
  avatarImage: { type: String, default: null } 
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
export default User;
