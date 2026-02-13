import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "./models/User.js"; 

dotenv.config();

const users = [
  { firstName: "Shahed", lastName: "Attia", phone: "12345678", mail: "rania.haddaji.pro@gmail.com", password: "password123", role: "Staff" },
  { firstName: "Ala", lastName: "Amor", phone: "87654321", mail: "rahmaromdhani1234@gmail.com", password: "123password", role: "Admin" }
];

const addUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected ✅");

    for (let u of users) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      const user = new User({
        ...u,
        password: hashedPassword
      });
      await user.save();
      console.log(`User ${u.firstName} ${u.lastName} Added ✅`);
    }

    await mongoose.disconnect();
    console.log("MongoDB disconnected ✅");
  } catch (err) {
    console.error(err);
  }
};

addUsers();
