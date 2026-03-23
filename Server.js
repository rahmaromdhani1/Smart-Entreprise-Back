import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { Server } from "socket.io";
import http from "http";
import authRoutes from "./Routes/auth.js";
import userRoutes from "./Routes/users.js";
import dashboardRoutes from "./Routes/Adash.js";
import PdashboardRoutes from "./Routes/Pdash.js";
import path from "path";
import { fileURLToPath } from "url";
import alertRoutes from "./Routes/alerte.route.js";
import reportsRoutes from "./Routes/reports.js";
import adminUsersRoutes from "./Routes/Adminusers.js";
import seuilRoutes from "./Routes/Seuil.route.js"; 
import EquipmentRoutes from "./Routes/Equipment.route.js";
dotenv.config();
console.log("MONGO_URI:", process.env.MONGO_URI); 

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.set("io", io); 
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(express.json());
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use("/uploads", express.static(path.join(path.resolve(), "uploads"))); 
app.use("/api/auth", authRoutes);
app.use("/api/seuils", seuilRoutes); 
app.use("/api/equipment", EquipmentRoutes); 
app.use("/api/user", userRoutes); 
app.use("/api/alerts", alertRoutes);
app.use('/api', reportsRoutes);
app.use("/api/users", adminUsersRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', PdashboardRoutes);
app.get("/", (req, res) => {
  res.send("Serveur OK !");
});
app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});
app.get("/reset-password/:token", (req, res) => {
  const token = req.params.token;
  console.log("🔑 Reset password page requested with token:", token);

  const filePath = path.join(__dirname, "public", "reset-password.html");
  console.log("📁 Chemin du fichier HTML:", filePath);

  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("❌ Erreur en envoyant le fichier:", err);
      res.status(500).send("Erreur serveur");
    } else {
      console.log("✅ Fichier HTML envoyé avec succès");
    }
  });
});
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);
});

setInterval(() => {
  const stats = {
    energy: { value: Math.floor(Math.random() * 5000), unit: "kWh", change: Math.floor(Math.random() * 20) - 10, trend: Math.random() > 0.5 ? "up" : "down" },
    temperature: { value: (Math.random() * 40).toFixed(1), unit: "°C", status: "Optimal" },
    activeStations: { current: Math.floor(Math.random() * 32), total: 32, percentage: Math.floor(Math.random() * 100) },
    alerts: { count: Math.floor(Math.random() * 10), change: Math.floor(Math.random() * 5), trend: Math.random() > 0.5 ? "up" : "down" }
  };
  const iotDistribution = { lights: Math.floor(Math.random() * 50), ac: Math.floor(Math.random() * 40), others: Math.floor(Math.random() * 20), total: 32 };
  const chartData = Array.from({ length: 7 }, () => ({ percentage: Math.floor(Math.random() * 100) }));

  io.emit("Adashboard-update", { stats, iotDistribution, chartData });
}, 5000);

// Officier dashboard
setInterval(() => {
  const stats = {
    energy: { value: Math.floor(Math.random() * 100), unit: "kWh", change: Math.floor(Math.random() * 10), trend: "up" },
    temperature: { value: (Math.random() * 40).toFixed(1), unit: "°C", status: "Optimal" },
    activeStations: { current: Math.floor(Math.random() * 32), total: 32, percentage: Math.floor(Math.random() * 100) },
    alerts: { count: Math.floor(Math.random() * 10), change: 2, trend: "up" }
  };
  const iotDistribution = { lights: Math.floor(Math.random() * 50), ac: Math.floor(Math.random() * 40), others: Math.floor(Math.random() * 20), total: 32 };
  const chartData = Array.from({ length: 7 }, () => ({ percentage: Math.floor(Math.random() * 100) }));

  io.emit("dashboard-update", { stats, iotDistribution, chartData });
}, 5000); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected ✅");

    const PORT = process.env.PORT || 5000;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });

  })
  .catch(err => console.log(err));