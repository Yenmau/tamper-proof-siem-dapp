
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    department: { type: String, default: "", trim: true },
    team: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.index({ name: "text", email: "text", department: "text" });

const User = mongoose.models.User || mongoose.model("User", UserSchema);

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/siem_offchain";

async function connect() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
}

function dbState() {
  const map = { 0: "terputus", 1: "tersambung", 2: "menyambung", 3: "memutus" };
  return map[mongoose.connection.readyState] || String(mongoose.connection.readyState);
}

async function createUser(payload, actor) {
  const walletAddress = String(payload.walletAddress || "").toLowerCase();
  const ada = await User.findOne({ walletAddress });
  if (ada) {
    const e = new Error("User dengan wallet itu sudah terdaftar");
    e.status = 409;
    throw e;
  }
  const doc = await User.create({
    walletAddress,
    name: payload.name,
    email: payload.email,
    department: payload.department || "",
    team: payload.team || "",
    active: payload.active !== false,
    notes: payload.notes || "",
    createdBy: actor || "",
    updatedBy: actor || "",
  });
  return doc;
}

async function listUsers({ q, team, active } = {}) {
  const filter = {};
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { email: rx }, { walletAddress: rx }, { department: rx }];
  }
  if (team) filter.team = team;
  if (active === "true" || active === true) filter.active = true;
  if (active === "false" || active === false) filter.active = false;
  return User.find(filter).sort({ createdAt: 1 }).lean();
}

async function getUser(walletAddress) {
  return User.findOne({ walletAddress: String(walletAddress).toLowerCase() }).lean();
}

async function updateUser(walletAddress, payload, actor) {
  const wallet = String(walletAddress).toLowerCase();
  const doc = await User.findOne({ walletAddress: wallet });
  if (!doc) {
    const e = new Error("User tidak ditemukan");
    e.status = 404;
    throw e;
  }
  const boleh = ["name", "email", "department", "team", "active", "notes"];
  for (const k of boleh) {
    if (payload[k] !== undefined) doc[k] = payload[k];
  }
  doc.updatedBy = actor || "";
  await doc.save();
  return doc;
}

async function deleteUser(walletAddress) {
  const wallet = String(walletAddress).toLowerCase();
  const res = await User.deleteOne({ walletAddress: wallet });
  if (!res.deletedCount) {
    const e = new Error("User tidak ditemukan");
    e.status = 404;
    throw e;
  }
  return { deleted: true, walletAddress: wallet };
}

module.exports = {
  User,
  MONGO_URI,
  connect,
  disconnect,
  dbState,
  createUser,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
};
