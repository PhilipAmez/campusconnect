const sqlite3 = require('better-sqlite3');
const db = sqlite3('./courseconnect.db');

db.transaction(() => {
    // Users
    db.prepare('INSERT OR REPLACE INTO users (uid, email, password, indexNumber, name, bio) VALUES (?, ?, ?, ?, ?, ?)').run(
        'user1', 'alice@example.com', 'password123', '123456', 'Alice', 'Freshman in ENGL 101'
    );
    db.prepare('INSERT OR REPLACE INTO users (uid, email, password, indexNumber, name, bio) VALUES (?, ?, ?, ?, ?, ?)').run(
        'user2', 'bob@example.com', 'password456', '789012', 'Bob', 'Sophomore in MATH 365'
    );
    db.prepare('INSERT OR REPLACE INTO users (uid, email, password, indexNumber, name, bio) VALUES (?, ?, ?, ?, ?, ?)').run(
        'studyspark', 'studyspark@example.com', 'ai123', '', 'StudySpark', 'AI Assistant'
    );

    // Groups
    db.prepare('INSERT OR REPLACE INTO groups (groupId, name, course, createdBy, members) VALUES (?, ?, ?, ?, ?)').run(
        'group1', 'ENGL 101 Study Group', 'engl101', 'user1', JSON.stringify({ user1: true, user2: true })
    );
    db.prepare('INSERT OR REPLACE INTO groups (groupId, name, course, createdBy, members) VALUES (?, ?, ?, ?, ?)').run(
        'group2', 'MATH 365 Prep', 'math365', 'user2', JSON.stringify({ user2: true })
    );

    // Messages
    db.prepare('INSERT OR REPLACE INTO messages (messageId, groupId, uid, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(
        'msg1', 'group1', 'user1', 'Alice', 'Anyone have notes for ENGL 101?', Date.now() - 3600000
    );
    db.prepare('INSERT OR REPLACE INTO messages (messageId, groupId, uid, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(
        'msg2', 'group1', 'user2', 'Bob', 'Let’s discuss thesis statements', Date.now() - 1800000
    );
    db.prepare('INSERT OR REPLACE INTO messages (messageId, groupId, uid, sender, text, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(
        'msg3', 'group1', 'studyspark', 'StudySpark', 'A thesis statement summarizes your main point. Example: "Exercise improves mental health."', Date.now() - 1700000
    );

    // Analytics
    db.prepare('INSERT OR REPLACE INTO analytics (groupId, uid, messagesSent) VALUES (?, ?, ?)').run('group1', 'user1', 1);
    db.prepare('INSERT OR REPLACE INTO analytics (groupId, uid, messagesSent) VALUES (?, ?, ?)').run('group1', 'user2', 1);
    db.prepare('INSERT OR REPLACE INTO analytics (groupId, uid, messagesSent) VALUES (?, ?, ?)').run('group1', 'studyspark', 1);

    // Resources
    db.prepare('INSERT OR REPLACE INTO resources (resourceId, course, title, url, type, relevanceScore) VALUES (?, ?, ?, ?, ?, ?)').run(
        'res1', 'engl101', 'Writing Guide', 'https://example.com/writing.pdf', 'pdf', 0.9
    );
    db.prepare('INSERT OR REPLACE INTO resources (resourceId, course, title, url, type, relevanceScore) VALUES (?, ?, ?, ?, ?, ?)').run(
        'res2', 'math365', 'Calculus Tutorial', 'https://example.com/calculus.mp4', 'video', 0.85
    );

    console.log('Test data inserted successfully.');
})();

db.close();