require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Create users table
const createUsersTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      profile_pic TEXT,
      badges TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(query);
};

// Create groups table
const createGroupsTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      course TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(query);
};

// Create messages table
const createMessagesTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id),
      sender_id INTEGER REFERENCES users(id),
      text TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      reply_to INTEGER REFERENCES messages(id),
      edited BOOLEAN DEFAULT FALSE,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(query);
};

// Call table creation functions on startup
(async () => {
  try {
    await createUsersTable();
    await createGroupsTable();
    await createMessagesTable();
    console.log('✅ Tables created (or already exist)');
  } catch (err) {
    console.error('❌ Error creating tables:', err);
  }
})();

// Basic route
app.get('/', (req, res) => {
  res.send('CampusConnect backend running!');
});

// Simple user registration
app.post('/register', async (req, res) => {
  const { name, email, password, profile_pic, badges } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password, profile_pic, badges) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, email, password, profile_pic || null, badges || null]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// GET messages for a group
app.get('/messages/:groupId', async (req, res) => {
  const groupId = req.params.groupId;
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE group_id = $1 ORDER BY timestamp ASC',
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST new message
app.post('/messages', async (req, res) => {
  const { group_id, sender_id, text, file_url, file_name, file_size, reply_to } = req.body;
  try {
    const result = await pool.query(
      `
      INSERT INTO messages (group_id, sender_id, text, file_url, file_name, file_size, reply_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [group_id, sender_id, text, file_url, file_name, file_size, reply_to]
    );

    // Emit the message to all clients in the group
    io.to('group_' + group_id).emit('new_message', result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PUT edit message
app.put('/messages/:id', async (req, res) => {
  const id = req.params.id;
  const { text } = req.body;
  try {
    const result = await pool.query(
      'UPDATE messages SET text = $1, edited = TRUE WHERE id = $2 RETURNING *',
      [text, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Socket.io real-time chat
io.on('connection', (socket) => {
  console.log('🟢 New client connected');

  socket.on('join_group', (groupId, username) => {
    socket.join('group_' + groupId);
    console.log(`${username || 'A user'} joined group ${groupId}`);
    io.to('group_' + groupId).emit('user_joined', username || 'Someone');
  });

  socket.on('typing', ({ groupId, user }) => {
    socket.to('group_' + groupId).emit('user_typing', user);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected');
  });
});


// Start server with correct port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Server with real-time chat running on port ' + PORT);
});