const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('📦 Connected to MongoDB Atlas.');
    } catch (err) {
        console.error('Database connection error:', err.message);
    }
};

// This ensures Mongoose outputs 'id' instead of '_id' to perfectly match our frontend expectations
const schemaOptions = {
    toJSON: {
        transform: (doc, ret) => {
            ret.id = ret._id.toString();
            delete ret._id;
            delete ret.__v;
        }
    }
};

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    is_online: { type: Boolean, default: false }
}, schemaOptions);

const messageSchema = new mongoose.Schema({
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    status: { type: String, default: 'sent' }
}, schemaOptions);

const contactSchema = new mongoose.Schema({
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, default: 'pending' }
}, schemaOptions);

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Contact = mongoose.model('Contact', contactSchema);

module.exports = { connectDB, User, Message, Contact };