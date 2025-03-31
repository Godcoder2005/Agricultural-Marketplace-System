require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const sequelize = require('./config/database');
const User = require('./models/User');

const app = express();

// Connect to MySQL silently
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: true });
    } catch (error) {
        console.error('Database connection error');
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

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        // Store the intended destination in session
        req.session.returnTo = req.originalUrl;
        res.redirect('/register?message=Please register or login to continue');
    }
};

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Registration Routes
app.get('/register', (req, res) => {
    const message = req.query.message || null;
    const returnTo = req.session.returnTo || '/dashboard';
    res.render('register', { error: null, message, returnTo });
});

app.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword, role } = req.body;
    const returnTo = req.session.returnTo || '/dashboard';

    try {
        // Validate password match
        if (password !== confirmPassword) {
            return res.render('register', { error: 'Passwords do not match', message: null, returnTo });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.render('register', { error: 'Email already registered', message: null, returnTo });
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

        // Clear the returnTo from session
        const redirectTo = returnTo;
        req.session.returnTo = null;

        // Redirect to stored path or dashboard
        res.redirect(redirectTo);
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', { error: 'An error occurred during registration', message: null, returnTo });
    }
});

// Login Routes
app.get('/login', (req, res) => {
    const message = req.query.message || null;
    const returnTo = req.session.returnTo || '/dashboard';
    res.render('login', { error: null, message, returnTo });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const returnTo = req.session.returnTo || '/dashboard';

    try {
        const user = await User.findOne({ where: { email: email } });
        
        if (!user || !(await user.comparePassword(password))) {
            return res.render('login', { 
                error: 'Invalid email or password', 
                message: null,
                returnTo 
            });
        }

        // Set session
        req.session.userId = user.id;
        req.session.userRole = user.role;

        // Clear the returnTo from session
        const redirectTo = returnTo;
        req.session.returnTo = null;

        res.redirect(redirectTo);
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { 
            error: 'An error occurred during login', 
            message: null,
            returnTo 
        });
    }
});

// Shop route (protected)
app.get('/shop', isAuthenticated, (req, res) => {
    res.send('Welcome to the shop!'); // You can create a shop.ejs view later
});

// Dashboard route (protected)
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.send('Welcome to your dashboard!'); // You can create a dashboard.ejs view later
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Home route
app.get('/', (req, res) => {
    res.render('home', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole 
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running → http://localhost:${PORT}`);
}); 