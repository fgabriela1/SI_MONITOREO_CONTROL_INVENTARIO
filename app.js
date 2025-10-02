// app.js
const express = require("express");
const path = require("path");
const mysql = require("mysql2"); // sin /promise

const app = express();
const PORT = 3000;

// ===== Conexión a MySQL (ajusta si hace falta) =====
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "1234",
  database: "control_de_inventario",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}).promise(); // API de promesas

// ===== Middlewares =====
app.use(express.json());

// Servir archivos estáticos DESDE LA CARPETA ACTUAL (donde está app.js)
app.use(express.static(__dirname));
console.log("Sirviendo estáticos desde:", __dirname);

// Ruta raíz -> roles.html (en la misma carpeta)
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "roles.html"));
});

// (Opcional) Probar conexión a la BD
app.get("/api/db-check", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: rows[0]?.ok === 1 });
  } catch (err) {
    console.error("DB error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== Login por rol =====
// POST /api/login?role=admin|gerente|empleado
// Body JSON: { "identifier": "usuario_o_correo", "password": "****" }
const roleToTable = {
  admin: "login_admin",
  gerente: "login_gerente",
  empleado: "login_empleado",
};

app.post("/api/login", async (req, res) => {
  const role = String(req.query.role || "").toLowerCase();
  const table = roleToTable[role];
  const { identifier, password } = req.body || {};

  if (!table) return res.status(400).json({ ok: false, error: "Rol inválido" });
  if (!identifier || !password)
    return res.status(400).json({ ok: false, error: "Faltan campos" });

  try {
    // (En producción usa bcrypt; aquí comparamos en texto plano)
    const [rows] = await pool.execute(
      `SELECT id, usuario, correo
       FROM ${table}
       WHERE (usuario = ? OR correo = ?) AND contrasena = ?
       LIMIT 1`,
      [identifier, identifier, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    res.json({ ok: true, role, user: rows[0] });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ ok: false, error: "Error del servidor" });
  }
});

// ===== Iniciar servidor =====
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
