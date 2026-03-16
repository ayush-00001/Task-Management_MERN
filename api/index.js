// Vercel Serverless Function - wraps the Express app
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ========================================
// Middleware
// ========================================
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// MongoDB Connection (cached for serverless)
// ========================================
let cachedConnection = null;

const connectDB = async () => {
    if (cachedConnection && mongoose.connection.readyState === 1) {
        return;
    }

    if (!process.env.MONGODB_URI) {
        console.error('No MONGODB_URI found in environment variables');
        return;
    }

    try {
        mongoose.set('strictQuery', false);
        cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
            bufferCommands: false,
        });
        console.log('MongoDB Connected (Vercel Serverless)');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        cachedConnection = null;
    }
};

// DB connection middleware
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

// ========================================
// Models (inline to avoid path issues)
// ========================================

// User Model
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        trim: true,
        minlength: [3, 'Username must be at least 3 characters long'],
        maxlength: [20, 'Username cannot exceed 20 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [
            /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
            'Please provide a valid email address'
        ]
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters long']
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Password comparison failed');
    }
};

userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

// Task Model
const taskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Task title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot exceed 500 characters'],
        default: ''
    },
    completed: {
        type: Boolean,
        default: false
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    category: {
        type: String,
        trim: true,
        maxlength: [50, 'Category cannot exceed 50 characters'],
        default: 'general'
    },
    dueDate: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Task must belong to a user']
    }
}, {
    timestamps: true
});

taskSchema.index({ user: 1, createdAt: -1 });
taskSchema.index({ user: 1, completed: 1 });

taskSchema.pre('save', function (next) {
    if (this.isModified('completed')) {
        if (this.completed && !this.completedAt) {
            this.completedAt = new Date();
        } else if (!this.completed) {
            this.completedAt = null;
        }
    }
    next();
});

taskSchema.set('toJSON', { virtuals: true });

const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);

// ========================================
// Auth Middleware
// ========================================
const auth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ message: 'No authorization header provided' });
        }
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Invalid authorization format. Use Bearer token' });
        }
        const token = authHeader.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }
        req.user = user;
        req.userId = user._id;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token has expired' });
        }
        res.status(500).json({ message: 'Authentication failed' });
    }
};

// ========================================
// Helper
// ========================================
const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// ========================================
// Health Check
// ========================================
app.get('/api/health', (req, res) => {
    res.json({
        message: 'Server is running on Vercel!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        dbConnected: mongoose.connection.readyState === 1
    });
});

// ========================================
// Auth Routes
// ========================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Please provide username, email, and password' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }
        const existingUser = await User.findOne({
            $or: [{ email: email.toLowerCase() }, { username }]
        });
        if (existingUser) {
            const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
            return res.status(400).json({ message: `User with this ${field} already exists` });
        }
        const user = new User({
            username: username.trim(),
            email: email.toLowerCase().trim(),
            password
        });
        await user.save();
        const token = generateToken(user._id);
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: user._id, username: user.username, email: user.email, role: user.role, createdAt: user.createdAt }
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: 'Validation error', errors });
        }
        res.status(500).json({ message: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password' });
        }
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        const token = generateToken(user._id);
        res.json({
            message: 'Login successful',
            token,
            user: { id: user._id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

app.get('/api/auth/me', auth, async (req, res) => {
    try {
        res.json({
            user: { id: req.user._id, username: req.user.username, email: req.user.email, role: req.user.role, createdAt: req.user.createdAt }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching user data' });
    }
});

// ========================================
// Task Routes
// ========================================
app.get('/api/tasks', auth, async (req, res) => {
    try {
        const { page = 1, limit = 10, completed, priority, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const query = { user: req.userId };
        if (completed !== undefined) query.completed = completed === 'true';
        if (priority) query.priority = priority;
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const tasks = await Task.find(query).sort(sort).skip(skip).limit(parseInt(limit));
        const total = await Task.countDocuments(query);
        res.json({
            tasks,
            pagination: { current: parseInt(page), pages: Math.ceil(total / parseInt(limit)), total, hasNext: skip + tasks.length < total, hasPrev: parseInt(page) > 1 }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching tasks' });
    }
});

app.post('/api/tasks', auth, async (req, res) => {
    try {
        const { title, description, priority } = req.body;
        if (!title || title.trim().length === 0) {
            return res.status(400).json({ message: 'Task title is required' });
        }
        const task = new Task({
            title: title.trim(),
            description: description ? description.trim() : '',
            priority: priority || 'medium',
            user: req.userId
        });
        await task.save();
        res.status(201).json({ message: 'Task created successfully', task });
    } catch (error) {
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: 'Validation error', errors });
        }
        res.status(500).json({ message: 'Server error creating task' });
    }
});

app.patch('/api/tasks/:id', auth, async (req, res) => {
    try {
        const { title, description, completed, priority } = req.body;
        const updateData = {};
        if (title !== undefined) {
            if (!title || title.trim().length === 0) {
                return res.status(400).json({ message: 'Task title cannot be empty' });
            }
            updateData.title = title.trim();
        }
        if (description !== undefined) updateData.description = description ? description.trim() : '';
        if (completed !== undefined) updateData.completed = completed;
        if (priority !== undefined) updateData.priority = priority;
        const task = await Task.findOneAndUpdate(
            { _id: req.params.id, user: req.userId },
            updateData,
            { new: true, runValidators: true }
        );
        if (!task) return res.status(404).json({ message: 'Task not found' });
        res.json({ message: 'Task updated successfully', task });
    } catch (error) {
        if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid task ID' });
        res.status(500).json({ message: 'Server error updating task' });
    }
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
    try {
        const task = await Task.findOneAndDelete({ _id: req.params.id, user: req.userId });
        if (!task) return res.status(404).json({ message: 'Task not found' });
        res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid task ID' });
        res.status(500).json({ message: 'Server error deleting task' });
    }
});

// ========================================
// Error Handling
// ========================================
app.use((err, req, res, next) => {
    console.error('Express error:', err.message);
    res.status(500).json({ message: 'Something went wrong!' });
});

// Export for Vercel serverless
module.exports = app;
