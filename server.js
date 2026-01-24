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

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decodedToken;
    next();
  } catch (err) {
    console.error('❌ Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}


// // Create tables on startup
// const createTables = async () => {
//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS users (
//       id SERIAL PRIMARY KEY,
//       name TEXT NOT NULL,
//       email TEXT UNIQUE NOT NULL,
//       password TEXT NOT NULL,
//       profile_pic TEXT,
//       badges TEXT,
//       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//     );
//   `);

//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS groups (
//       id SERIAL PRIMARY KEY,
//       name TEXT NOT NULL,
//       course TEXT,
//       created_by INTEGER REFERENCES users(id),
//       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//     );
//   `);

//   await pool.query(`
//     CREATE TABLE IF NOT EXISTS messages (
//       id SERIAL PRIMARY KEY,
//       group_id INTEGER REFERENCES groups(id),
//       sender_id INTEGER REFERENCES users(id),
//       text TEXT,
//       file_url TEXT,
//       file_name TEXT,
//       file_size INTEGER,
//       reply_to INTEGER,
//       edited BOOLEAN DEFAULT FALSE,
//       timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//     );
//   `);
// };

// createTables().then(() => console.log('✅ Tables ready')).catch(console.error);

// Routes
app.get('/', (req, res) => res.send('CampusConnect backend running!'));

// ============= AI API KEY ENDPOINT =============
app.get('/api/ai-key', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  res.json({ apiKey });
});

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

app.get('/groups', verifyFirebaseToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM groups ORDER BY created_at DESC');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.post('/groups', verifyFirebaseToken, async (req, res) => {
  const { name, course } = req.body;
  const email = req.firebaseUser.email;
  const result = await pool.query(
    'INSERT INTO groups (name, course, created_by_email) VALUES ($1, $2, $3) RETURNING *',
    [name, course, email]
  );
  res.status(201).json(result.rows[0]);
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

    // --- Create Notifications ---
    // 1. Get group members
    const membersRes = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2',
      [group_id, sender_id]
    );

    // 2. Create a notification for each member
    for (const member of membersRes.rows) {
      const notifQuery = {
        text: `INSERT INTO notifications (user_id, sender_id, type, content, post_id)
               VALUES ($1, $2, 'new_group_message', $3, $4)`,
        values: [member.user_id, sender_id, `New message in your group`, group_id],
      };
      await pool.query(notifQuery);
    }
    // --- End Notification ---

    res.status(201).json(msg);
  } catch (err) {
    console.error('Error sending message or creating notification:', err);
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