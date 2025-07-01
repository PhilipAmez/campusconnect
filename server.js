require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create tables on startup
const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      profile_pic TEXT,
      badges TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      course TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id),
      sender_id INTEGER REFERENCES users(id),
      text TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      reply_to INTEGER,
      edited BOOLEAN DEFAULT FALSE,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

createTables().then(() => console.log('✅ Tables ready')).catch(console.error);

// Routes
app.get('/', (req, res) => res.send('CampusConnect backend running!'));

app.post('/users', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
      [name, email, password]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.get('/groups', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM groups ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.post('/groups', async (req, res) => {
  const { name, course, created_by } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO groups (name, course, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name, course, created_by || null]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.get('/messages/:groupId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE group_id = $1 ORDER BY timestamp ASC',
      [req.params.groupId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/messages', upload.none(), async (req, res) => {
  const { group_id, sender_id, text, file_url, file_name, file_size, reply_to } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO messages (group_id, sender_id, text, file_url, file_name, file_size, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [group_id, sender_id, text, file_url, file_name, file_size, reply_to]
    );
    const msg = result.rows[0];
    io.to('group_' + group_id).emit('new_message', msg);
    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Socket.IO events
io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => {
    socket.join('group_' + groupId);
  });

  socket.on('typing', ({ groupId, user }) => {
    socket.to('group_' + groupId).emit('user_typing', user);
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🚀 Backend running on port', PORT));