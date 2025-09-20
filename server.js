// server.js
// Full server with services, plans, announcements, work uploads, subscribe, auth.
// Make sure to set DB connection in .env or edit defaults below.

require('dotenv').config();

const fs = require('fs');
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;

// ensure uploads dir exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// static serving
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR)); // serve uploaded files

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // safe filename: timestamp-original
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// --- MySQL connection pool ---
// NOTE: adjust DB_PORT in .env if your MySQL runs on non-default port (e.g. 3307)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'legit_city',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3307,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test DB connection
async function testDBConnection() {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    console.log('✅ Connected to MySQL successfully!');
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
  }
}

// =============================
// Helpers
// =============================
const BASE_CURRENCY = 'USD';
async function getRate(toCurrency) {
  if (!toCurrency || toCurrency.toUpperCase() === BASE_CURRENCY) return 1;
  try {
    const url = `https://api.exchangerate.host/latest?base=${BASE_CURRENCY}&symbols=${toCurrency}`;
    const { data } = await axios.get(url);
    return data?.rates?.[toCurrency.toUpperCase()] || 1;
  } catch (err) {
    console.warn('Exchange API failed, defaulting rate=1', err.message);
    return 1;
  }
}

// =============================
// Serve home / dashboards (static files in public/)
// =============================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html')));
app.get('/user-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-dashboard.html')));

// =============================
// Authentication
// =============================
app.post('/register', async (req, res) => {
  try {
    const { name, email, password, accountType } = req.body;
    if (!name || !email || !password || !accountType) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (name, email, password, account_type) VALUES (?, ?, ?, ?)', [name, email, hashed, accountType]);
    res.status(201).json({ success: true, message: 'Registration successful' });
  } catch (err) {
    console.error('Registration error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Email already registered' });
    res.status(500).json({ message: 'Error registering user' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const redirectUrl = user.account_type === 'admin' ? '/admin-dashboard' : '/user-dashboard';
    res.json({
      success: true,
      message: 'Login successful',
      redirectUrl: redirectUrl + `?name=${encodeURIComponent(user.name)}&id=${user.id}`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountType: user.account_type,
        verified: user.verified || 0,
        subscription_expires_at: user.subscription_expires_at || null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// =============================
// Plans (create + list)
// =============================

// Create plan (admin)
app.post('/api/plans', async (req, res) => {
  try {
    const { adminId, name, description, price, duration } = req.body;
    if (!adminId || !name || !price || !duration) {
      return res.status(400).json({ message: 'adminId, name, price and duration are required' });
    }
    const sql = 'INSERT INTO plans (admin_id, name, description, price_usd, duration_days, active) VALUES (?, ?, ?, ?, ?, 1)';
    const [result] = await pool.query(sql, [adminId, name, description || '', price, duration]);
    res.json({ success: true, message: 'Plan created', planId: result.insertId });
  } catch (err) {
    console.error('Create plan error:', err);
    res.status(500).json({ message: 'Error creating plan' });
  }
});

// Get plans (with exchange)
app.get('/api/plans', async (req, res) => {
  try {
    const currency = (req.query.currency || BASE_CURRENCY).toUpperCase();
    const [plans] = await pool.query(`
      SELECT p.*, u.name AS admin_name
      FROM plans p
      LEFT JOIN users u ON p.admin_id = u.id
      WHERE p.active = 1
      ORDER BY p.created_at DESC
    `);
    const rate = await getRate(currency);
    const mapped = plans.map(p => ({
      id: p.id,
      admin_id: p.admin_id,
      admin_name: p.admin_name,
      name: p.name,
      description: p.description,
      price_usd: Number(p.price_usd),
      duration_days: p.duration_days,
      currency,
      price_local: Number((Number(p.price_usd) * rate).toFixed(2)),
      created_at: p.created_at
    }));
    res.json({ plans: mapped, base: BASE_CURRENCY, currency, rate });
  } catch (err) {
    console.error('Fetch plans error:', err);
    res.status(500).json({ message: 'Error fetching plans' });
  }
});

// =============================
// Subscribe (user -> service or plan)
// =============================

app.post('/subscribe', async (req, res) => {
  try {
    const { userId, serviceId, planId } = req.body;
    if (!userId || (!serviceId && !planId)) {
      return res.status(400).json({ message: 'userId and serviceId or planId required' });
    }
    // If subscribing to a service (no money processing here)
    if (serviceId) {
      await pool.query('INSERT INTO subscriptions (user_id, service_id) VALUES (?, ?)', [userId, serviceId]);
      return res.json({ success: true, message: 'Subscribed to service' });
    }
    // If subscribing to a plan
    if (planId) {
      await pool.query('INSERT INTO subscriptions (user_id, plan_id) VALUES (?, ?)', [userId, planId]);
      return res.json({ success: true, message: 'Subscribed to plan' });
    }
    res.status(400).json({ message: 'Invalid subscription request' });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ message: 'Error subscribing' });
  }
});

// =============================
// Services (create + list)
// =============================

// Create a service (admin)
app.post('/api/services', async (req, res) => {
  try {
    const { service, level, adminId } = req.body;
    if (!service || !level || !adminId) return res.status(400).json({ message: 'All fields required' });
    await pool.query('INSERT INTO services (service, level, admin_id) VALUES (?, ?, ?)', [service, level, adminId]);
    res.json({ success: true, message: 'Service created' });
  } catch (err) {
    console.error('Create service error:', err);
    res.status(500).json({ message: 'Error creating service' });
  }
});

// Get all services
app.get('/api/services', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.service, s.level, s.admin_id, u.name as admin_name, s.created_at
      FROM services s
      LEFT JOIN users u ON s.admin_id = u.id
      ORDER BY s.created_at DESC
    `);
    res.json({ services: rows });
  } catch (err) {
    console.error('Fetch services error:', err);
    res.status(500).json({ message: 'Error fetching services' });
  }
});

// backward-compatible GET /services (no /api)
app.get('/services', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, service, level, admin_id FROM services ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Fetch /services error:', err);
    res.status(500).json({ message: 'Error' });
  }
});

// =============================
// Announcements (create + list)
// =============================

app.post('/api/announcements', async (req, res) => {
  try {
    const { title, content, adminId } = req.body;
    if (!content || !adminId) return res.status(400).json({ message: 'content and adminId required' });
    // allow missing title -> set empty string
    await pool.query('INSERT INTO announcements (title, content, admin_id) VALUES (?, ?, ?)', [title || '', content, adminId]);
    res.json({ success: true, message: 'Announcement created' });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ message: 'Error creating announcement' });
  }
});

// GET announcements (api)
app.get('/api/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.title, a.content, a.created_at, u.name AS admin_name
      FROM announcements a
      LEFT JOIN users u ON a.admin_id = u.id
      ORDER BY a.created_at DESC
    `);
    res.json({ announcements: rows });
  } catch (err) {
    console.error('Fetch announcements error:', err);
    res.status(500).json({ message: 'Error fetching announcements' });
  }
});

// backward-compatible GET /announcements
app.get('/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, title, content, created_at FROM announcements ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('/announcements error:', err);
    res.status(500).json({ message: 'Error' });
  }
});

// =============================
// Work uploads (create + list)
// =============================

// POST /api/work - expects form data: file (field name "file"), title, description, adminId
app.post('/api/work', upload.single('file'), async (req, res) => {
  try {
    const { title, description, adminId } = req.body;
    if (!title || !description || !adminId) return res.status(400).json({ message: 'title, description and adminId required' });

    const filePath = req.file ? req.file.filename : null;
    await pool.query('INSERT INTO work (title, description, file_path, admin_id) VALUES (?, ?, ?, ?)', [title, description, filePath, adminId]);
    res.json({ success: true, message: 'Work uploaded' });
  } catch (err) {
    console.error('Work upload error:', err);
    res.status(500).json({ message: 'Error uploading work' });
  }
});

// GET /api/work
app.get('/api/work', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT w.id, w.title, w.description, w.file_path, w.created_at, u.name AS admin_name
      FROM work w
      LEFT JOIN users u ON w.admin_id = u.id
      ORDER BY w.created_at DESC
    `);
    res.json({ work: rows });
  } catch (err) {
    console.error('Fetch work error:', err);
    res.status(500).json({ message: 'Error fetching work' });
  }
});

// =============================
// Start server
// =============================
app.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  await testDBConnection();
});
