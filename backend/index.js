require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connectDB, User, Message, Contact } = require('./db/database.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

connectDB(); // Initialize MongoDB

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT"] } 
});

const activeSockets = {};

// Helper to format messages
const formatMessage = (msg) => ({
    id: msg.id,
    sender_id: msg.sender_id.id || msg.sender_id.toString(),
    receiver_id: msg.receiver_id.toString(),
    content: msg.content,
    timestamp: msg.timestamp,
    status: msg.status,
    username: msg.sender_id.username 
});

io.on('connection', (socket) => {
  socket.on('register_user', async (userId) => {
    activeSockets[userId] = socket.id;
    await User.findByIdAndUpdate(userId, { is_online: true });
    io.emit('user_status_changed'); 
  });

  socket.on('send_invite', async (data) => {
    const { sender_id, receiver_id } = data;
    const contact = await Contact.create({ sender_id, receiver_id, status: 'pending' });
    if (activeSockets[receiver_id]) io.to(activeSockets[receiver_id]).emit('contact_updated', contact);
    socket.emit('contact_updated', contact);
  });

  socket.on('update_invite', async (data) => {
    const { contact_id, status, sender_id, receiver_id } = data;
    if (status === 'rejected') {
        await Contact.findByIdAndDelete(contact_id);
        const payload = { id: contact_id, status: 'none' }; 
        if (activeSockets[sender_id]) io.to(activeSockets[sender_id]).emit('contact_updated', payload);
        if (activeSockets[receiver_id]) io.to(activeSockets[receiver_id]).emit('contact_updated', payload);
    } else {
        const updated = await Contact.findByIdAndUpdate(contact_id, { status }, { new: true });
        if (activeSockets[sender_id]) io.to(activeSockets[sender_id]).emit('contact_updated', updated);
        if (activeSockets[receiver_id]) io.to(activeSockets[receiver_id]).emit('contact_updated', updated);
    }
  });

  socket.on('send_private_message', async (data) => {
    const { sender_id, receiver_id, content } = data;
    let message = await Message.create({ sender_id, receiver_id, content });
    message = await message.populate('sender_id', 'username');
    
    const formattedMsg = formatMessage(message);
    const receiverSocketId = activeSockets[receiver_id];
    
    if (receiverSocketId) io.to(receiverSocketId).emit('receive_private_message', formattedMsg);
    socket.emit('receive_private_message', formattedMsg);
  });

  socket.on('disconnect', async () => {
    let disconnectedUserId = null;
    for (const [userId, socketId] of Object.entries(activeSockets)) {
        if (socketId === socket.id) {
            disconnectedUserId = userId;
            delete activeSockets[userId]; 
            break;
        }
    }
    if (disconnectedUserId) {
        await User.findByIdAndUpdate(disconnectedUserId, { is_online: false });
        io.emit('user_status_changed');
    }
  });
});

// --- REST APIs ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        const user = await User.create({ username, password, is_online: true });
        res.json(user);
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: 'Username already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: 'User not found.' });
        if (user.password !== password) return res.status(401).json({ error: 'Incorrect password.' });
        
        user.is_online = true;
        await user.save();
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password } = req.body;
        await User.findByIdAndUpdate(id, { username, password });
        io.emit('user_status_changed');
        res.json({ success: true, username });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: 'Username already taken' });
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'username is_online');
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const contacts = await Contact.find({ $or: [{ sender_id: userId }, { receiver_id: userId }] });
        res.json(contacts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [ { sender_id: user1, receiver_id: user2 }, { sender_id: user2, receiver_id: user1 } ]
        }).sort({ timestamp: 1 }).populate('sender_id', 'username');
        
        res.json(messages.map(formatMessage));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));