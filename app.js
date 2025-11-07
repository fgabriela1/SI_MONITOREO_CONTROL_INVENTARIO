// app.js
const express = require("express");
const path = require("path");
const mysql = require("mysql2"); // sin /promise

const app = express();
const PORT = 3000;

// ===== Conexión a MySQL =====
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

// ===== Mapeo de rol -> tabla =====
const roleToTable = {
  admin: "login_admin",
  gerente: "login_gerente",
  empleado: "login_empleado",
};

// ===== Login por rol =====
// POST /api/login?role=admin|gerente|empleado
// Body JSON: { "identifier": "usuario_o_correo", "password": "****" }
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

// ===== Crear usuario por rol =====
// POST /api/users
// Body: { "rol": "admin"|"gerente"|"empleado", "usuario": "...", "correo": "...", "contrasena": "..." }
app.post("/api/users", async (req, res) => {
  try {
    const { rol, usuario, correo, contrasena } = req.body || {};
    const role = String(rol || "").toLowerCase();
    const table = roleToTable[role];

    if (!table) return res.status(400).json({ ok: false, error: "Rol inválido" });
    if (!usuario || !correo || !contrasena)
      return res.status(400).json({ ok: false, error: "Faltan campos" });

    const [result] = await pool.execute(
      `INSERT INTO ${table} (usuario, correo, contrasena) VALUES (?, ?, ?)`,
      [usuario, correo, contrasena] // Texto plano para tu login actual
    );

    res.status(201).json({ ok: true, id: result.insertId, role });
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || String(err.message).includes("Duplicate entry"))) {
      return res.status(409).json({ ok: false, error: "Usuario o correo ya existe" });
    }
    console.error("Create user error:", err);
    res.status(500).json({ ok: false, error: "Error del servidor" });
  }
});

/* ===================== PRODUCTOS (con columna 'categoria') ===================== */

// GET /api/products  (listar todos)
app.get("/api/products", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, name, categoria, price, stock, min_stock, created_at, updated_at
       FROM productos
       ORDER BY id DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("List products error:", err);
    res.status(500).json({ ok: false, error: "Error listando productos" });
  }
});

// GET /api/products/:id
app.get("/api/products/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, code, name, categoria, price, stock, min_stock, created_at, updated_at
       FROM productos WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "No encontrado" });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error("Get product error:", err);
    res.status(500).json({ ok: false, error: "Error obteniendo producto" });
  }
});

// POST /api/products  (crear)
app.post("/api/products", async (req, res) => {
  try {
    const { code, name, categoria, price = 0, stock = 0, min_stock = 0 } = req.body || {};
    if (!code || !name || !categoria)
      return res.status(400).json({ ok: false, error: "code, name y categoria son obligatorios" });

    const [result] = await pool.execute(
      `INSERT INTO productos (code, name, categoria, price, stock, min_stock)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, name, categoria, Number(price || 0), parseInt(stock || 0), parseInt(min_stock || 0)]
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || String(err.message).includes("Duplicate entry"))) {
      return res.status(409).json({ ok: false, error: "El código ya existe" });
    }
    console.error("Create product error:", err);
    res.status(500).json({ ok: false, error: "Error creando producto" });
  }
});

// PUT /api/products/:id  (actualizar parcial)
app.put("/api/products/:id", async (req, res) => {
  try {
    const { code, name, categoria, price, stock, min_stock } = req.body || {};

    const fields = [];
    const params = [];
    if (code !== undefined)      { fields.push("code = ?");      params.push(code); }
    if (name !== undefined)      { fields.push("name = ?");      params.push(name); }
    if (categoria !== undefined) { fields.push("categoria = ?"); params.push(categoria); }
    if (price !== undefined)     { fields.push("price = ?");     params.push(Number(price)); }
    if (stock !== undefined)     { fields.push("stock = ?");     params.push(parseInt(stock)); }
    if (min_stock !== undefined) { fields.push("min_stock = ?"); params.push(parseInt(min_stock)); }

    if (!fields.length) return res.status(400).json({ ok: false, error: "Nada para actualizar" });

    params.push(req.params.id);
    const [result] = await pool.execute(
      `UPDATE productos SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    res.json({ ok: true, updated: result.affectedRows > 0 });
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || String(err.message).includes("Duplicate entry"))) {
      return res.status(409).json({ ok: false, error: "El código ya existe" });
    }
    console.error("Update product error:", err);
    res.status(500).json({ ok: false, error: "Error actualizando producto" });
  }
});

// DELETE /api/products/:id
app.delete("/api/products/:id", async (req, res) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM productos WHERE id = ?`,
      [req.params.id]
    );
    res.json({ ok: true, deleted: result.affectedRows > 0 });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ ok: false, error: "Error eliminando producto" });
  }
});

// ===== Iniciar servidor =====
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
