// server.js
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// __dirname workaround for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files (images, JS, CSS)
app.use(express.static(__dirname));

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Add more routes if needed
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


/*require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('better-sqlite3');

const app = express();
const db = sqlite3('./courseconnect.db', { verbose: console.log });

app.use(cors());
app.use(express.json());



// Authentication middleware (simplified for testing)
const authenticate = (req, res, next) => {
    const user = req.headers['x-user'];
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = JSON.parse(user);
    next();
};

// User registration
app.post('/register', (req, res) => {
    const { email, password, indexNumber, name, bio } = req.body;
    if (!email || !password || !indexNumber || !name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const uid = 'user_' + Date.now();
    try {
        db.prepare(`
            INSERT INTO users (uid, email, password, indexNumber, name, bio)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(uid, email, password, indexNumber, name, bio || '');
        res.json({ success: true, uid });
    } catch (error) {
        res.status(400).json({ error: 'User already exists or invalid data' });
    }
});

// Get registered users
app.get('/users', authenticate, (req, res) => {
    const users = db.prepare(`
        SELECT uid, email, indexNumber, name, bio, courses
        FROM users
        WHERE uid != ?
    `).all(req.user.uid);
    res.json(users.map(u => ({
        uid: u.uid,
        name: u.name,
        email: u.email,
        indexNumber: u.indexNumber,
        bio: u.bio,
        courses: JSON.parse(u.courses)
    })));
});

// Get groups
app.get('/groups', authenticate, (req, res) => {
    const groups = db.prepare(`
        SELECT groupId, name, course, members
        FROM groups
        WHERE members LIKE ?
    `).all(`%${req.user.uid}%`);
    res.json(groups.map(g => ({
        groupId: g.groupId,
        name: g.name,
        course: g.course,
        members: JSON.parse(g.members)
    })));
});

// Get messages
app.get('/groups/:groupId/messages', authenticate, (req, res) => {
    const messages = db.prepare(`
        SELECT messageId, uid, sender, text, fileUrl, fileName, fileSize, timestamp, replyTo, edited
        FROM messages
        WHERE groupId = ?
    `).all(req.params.groupId);
    res.json(messages);
});

// Post message (placeholder for @StudySpark)
app.post('/groups/:groupId/messages', authenticate, (req, res) => {
    const { text, fileUrl, fileName, fileSize, replyTo } = req.body;
    const messageId = Date.now().toString();
    const groupId = req.params.groupId;
    const sender = req.user.name || req.user.email.split('@')[0];
    const timestamp = Date.now();

    db.prepare(`
        INSERT INTO messages (messageId, groupId, uid, sender, text, fileUrl, fileName, fileSize, timestamp, replyTo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        messageId, groupId, req.user.uid, sender, text, fileUrl, fileName, fileSize, timestamp, replyTo ? JSON.stringify(replyTo) : null
    );

    db.prepare(`
        INSERT OR REPLACE INTO analytics (groupId, uid, messagesSent)
        VALUES (?, ?, COALESCE((SELECT messagesSent FROM analytics WHERE groupId = ? AND uid = ?), 0) + 1)
    `).run(groupId, req.user.uid, groupId, req.user.uid);

    // Placeholder for @StudySpark (remove or replace with API call)
    if (text && text.toLowerCase().startsWith('@studyspark')) {
        const query = text.slice(11).trim();
        if (query) {
            const aiMessageId = (Date.now() + 1).toString();
            db.prepare(`
                INSERT INTO messages (messageId, groupId, uid, sender, text, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                aiMessageId, groupId, 'studyspark', 'StudySpark', 'AI response placeholder (integrate Grok API later)', Date.now()
            );
        }
    }

    res.json({ success: true });
});

// Get recommendations
app.get('/groups/:groupId/recommendations', authenticate, (req, res) => {
    const group = db.prepare('SELECT course FROM groups WHERE groupId = ?').get(req.params.groupId);
    const messages = db.prepare('SELECT text FROM messages WHERE groupId = ?').all(req.params.groupId);
    const keywords = messages.flatMap(m => m.text ? m.text.toLowerCase().split(/\s+/).filter(w => w.length > 3) : []);
    const uniqueKeywords = [...new Set(keywords)].slice(0, 5);
    const resources = db.prepare(`
        SELECT resourceId, course, title, url, type, relevanceScore
        FROM resources
        WHERE course = ? OR title LIKE ?
    `).all(group.course, `%${uniqueKeywords.join('%')}%`);
    res.json(resources);
});

// Save resource
app.post('/users/:uid/resources', authenticate, (req, res) => {
    const { resourceId } = req.body;
    const user = db.prepare('SELECT savedResources FROM users WHERE uid = ?').get(req.user.uid);
    const saved = user ? JSON.parse(user.savedResources) : {};
    saved[resourceId] = true;
    db.prepare('UPDATE users SET savedResources = ? WHERE uid = ?').run(JSON.stringify(saved), req.user.uid);
    res.json({ success: true });
});

// Search users and groups
app.get('/search', authenticate, (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    const groups = db.prepare(`
        SELECT groupId, name, course
        FROM groups
        WHERE name LIKE ? OR course LIKE ?
    `).all(`%${query}%`, `%${query}%`);
    const users = db.prepare(`
        SELECT uid, email, indexNumber, name, bio
        FROM users
        WHERE email LIKE ? OR indexNumber LIKE ? OR name LIKE ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`);
    res.json({
        groups: groups.map(g => ({ groupId: g.groupId, name: g.name, course: g.course })),
        users: users.map(u => ({ uid: u.uid, name: u.name, email: u.email, indexNumber: u.indexNumber, bio: u.bio }))
    });
});

// File upload (mock)
app.post('/upload', (req, res) => {
    res.json({
        url: 'https://example.com/file.pdf',
        name: 'uploaded_file.pdf',
        size: 1024
    });
});

 app.listen(3001, () => console.log('Server running on http://localhost:3001'));
 */