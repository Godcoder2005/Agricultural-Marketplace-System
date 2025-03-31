require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const sequelize = require('./config/database');
const User = require('./models/User');

const app = express();

// Connect to MySQL
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Connected to MySQL database');
        
        // Sync all models
        await sequelize.sync({ alter: true });
        console.log('Database models synchronized');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}

initializeDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Registration Routes
app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword, role } = req.body;

    try {
        // Validate password match
        if (password !== confirmPassword) {
            return res.render('register', { error: 'Passwords do not match' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.render('register', { error: 'Email already registered' });
        }

        // Create new user
        const user = await User.create({
            name,
            email,
            password,
            role
        });

        // Set session
        req.session.userId = user.id;
        req.session.userRole = user.role;

        // Redirect to dashboard
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', { error: 'An error occurred during registration' });
    }
});

// Login Routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Find user by email
        const user = await User.findOne({ where: { email: email } });
        
        if (!user) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        
        if (!isValidPassword) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        // Set session
        req.session.userId = user.id;
        req.session.userRole = user.role;
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login' });
    }
});

// Dashboard route (protected)
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.send('Welcome to your dashboard!'); // You can create a dashboard.ejs view later
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 