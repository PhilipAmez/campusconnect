const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./courseconnect.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            uid TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            indexNumber TEXT UNIQUE,
            name TEXT,
            bio TEXT,
            courses TEXT DEFAULT '{}',
            badges TEXT DEFAULT '{}',
            savedResources TEXT DEFAULT '{}'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS groups (
            groupId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            course TEXT,
            createdBy TEXT,
            members TEXT DEFAULT '{}',
            FOREIGN KEY (createdBy) REFERENCES users(uid)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            messageId TEXT PRIMARY KEY,
            groupId TEXT,
            uid TEXT,
            sender TEXT,
            text TEXT,
            fileUrl TEXT,
            fileName TEXT,
            fileSize INTEGER,
            timestamp INTEGER,
            replyTo TEXT,
            edited BOOLEAN DEFAULT 0,
            FOREIGN KEY (groupId) REFERENCES groups(groupId),
            FOREIGN KEY (uid) REFERENCES users(uid)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS analytics (
            groupId TEXT,
            uid TEXT,
            messagesSent INTEGER DEFAULT 0,
            filesShared INTEGER DEFAULT 0,
            activeHours TEXT DEFAULT '{}',
            PRIMARY KEY (groupId, uid),
            FOREIGN KEY (groupId) REFERENCES groups(groupId),
            FOREIGN KEY (uid) REFERENCES users(uid)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS resources (
            resourceId TEXT PRIMARY KEY,
            course TEXT,
            title TEXT,
            url TEXT,
            type TEXT,
            relevanceScore REAL
        )
    `);

    console.log('Database schema created successfully.');
});

db.close();