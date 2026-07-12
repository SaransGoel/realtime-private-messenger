require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db/database.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const activeSockets = {};

io.on('connection', (socket) => {
  socket.on('register_user', (userId) => {
    activeSockets[userId] = socket.id;
    db.run('UPDATE users SET is_online = 1 WHERE id = ?', [userId], () => {
        io.emit('user_status_changed'); 
    });
  });

  // --- NEW: Handle Sending Invitations ---
  socket.on('send_invite', (data) => {
    const { sender_id, receiver_id } = data;
    db.run('INSERT INTO contacts (sender_id, receiver_id, status) VALUES (?, ?, ?)', 
      [sender_id, receiver_id, 'pending'], function(err) {
        if (err) return console.error(err);
        const newContact = { id: this.lastID, sender_id, receiver_id, status: 'pending' };
        
        // Notify both users instantly
        if (activeSockets[receiver_id]) io.to(activeSockets[receiver_id]).emit('contact_updated', newContact);
        socket.emit('contact_updated', newContact);
    });
  });

  // --- NEW: Handle Accepting/Rejecting Invitations ---
  socket.on('update_invite', (data) => {
    const { contact_id, status, sender_id, receiver_id } = data;
    
    if (status === 'rejected') {
        db.run('DELETE FROM contacts WHERE id = ?', [contact_id], () => {
            const payload = { id: contact_id, status: 'none' }; // Tells frontend to remove it
            if (activeSockets[sender_id]) io.to(activeSockets[sender_id]).emit('contact_updated', payload);
            if (activeSockets[receiver_id]) io.to(activeSockets[receiver_id]).emit('contact_updated', payload);
        });
    } else {
        db.run('UPDATE contacts SET status = ? WHERE id = ?', [status, contact_id], () => {
            db.get('SELECT * FROM contacts WHERE id = ?', [contact_id], (err, row) => {
                if (row) {
                    if (activeSockets[row.sender_id]) io.to(activeSockets[row.sender_id]).emit('contact_updated', row);
                    if (activeSockets[row.receiver_id]) io.to(activeSockets[row.receiver_id]).emit('contact_updated', row);
                }
            });
        });
    }
  });

  socket.on('send_private_message', (data) => {
    const { sender_id, receiver_id, content } = data;
    
    db.run('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', 
    [sender_id, receiver_id, content], function(err) {
        if (err) return console.error(err.message);
        
        db.get(`
            SELECT messages.*, users.username 
            FROM messages 
            JOIN users ON messages.sender_id = users.id 
            WHERE messages.id = ?
        `, [this.lastID], (err, row) => {
            if (!err && row) {
                const receiverSocketId = activeSockets[receiver_id];
                if (receiverSocketId) io.to(receiverSocketId).emit('receive_private_message', row);
                socket.emit('receive_private_message', row);
            }
        });
    });
  });

  socket.on('disconnect', () => {
    let disconnectedUserId = null;
    for (const [userId, socketId] of Object.entries(activeSockets)) {
        if (socketId === socket.id) {
            disconnectedUserId = userId;
            delete activeSockets[userId]; 
            break;
        }
    }
    if (disconnectedUserId) {
        db.run('UPDATE users SET is_online = 0 WHERE id = ?', [disconnectedUserId], () => {
            io.emit('user_status_changed');
        });
    }
  });
});

// --- REST APIs ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    db.run('INSERT INTO users (username, password, is_online) VALUES (?, ?, 1)', [username, password], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, username, is_online: 1 });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'User not found. Please register first.' });
        if (user.password !== password) return res.status(401).json({ error: 'Incorrect password.' });
        db.run('UPDATE users SET is_online = 1 WHERE id = ?', [user.id]);
        res.json({ id: user.id, username: user.username, is_online: 1 });
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    db.run('UPDATE users SET username = ?, password = ? WHERE id = ?', [username, password, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('user_status_changed');
        res.json({ success: true, username });
    });
});

app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, is_online FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// NEW API: Fetch contacts/invitations for a specific user
app.get('/api/contacts/:userId', (req, res) => {
    const { userId } = req.params;
    db.all('SELECT * FROM contacts WHERE sender_id = ? OR receiver_id = ?', [userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const query = `
        SELECT messages.*, users.username 
        FROM messages JOIN users ON messages.sender_id = users.id 
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY messages.timestamp ASC
    `;
    db.all(query, [user1, user2, user2, user1], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));