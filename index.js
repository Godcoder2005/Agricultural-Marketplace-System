require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const sequelize = require('./config/database');
const User = require('./models/User');
const Product = require('./models/products'); 
const bcrypt = require('bcryptjs');
const app = express();
const mysql = require('mysql2');
const connection = mysql.createConnection({
    host: process.env.DB_HOST,  // Change if necessary
    user: process.env.DB_USER,       // Change to your DB user
    password: process.env.DB_PASSWORD,       // Change to your DB password
    database: process.env.DB_NAME // Change to your database name
});
            
// Connect to MySQL silently
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: true });
        console.log('Database models synchronized');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}
User.hasMany(Product, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Product.belongsTo(User, { foreignKey: 'user_id' });
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

// Admin Authentication Middleware
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
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
        req.session.username=user.name;
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
app.get('/shop', isAuthenticated, async (req, res) => {
    const user = await User.findByPk(req.session.userId);

    if (user.role === 'farmer') {
        // Render the page where farmers can add products
        res.render('farmer',{user : req.session.username}); // You can adjust this to match your view name
    } else {
        // Fetch products for buyers
        const products = await Product.findAll({
            include: {
                model: User,  // Assuming you have a User model
                attributes: ['email'] // Fetch only the email field
            }
        });
        res.render('buyer', { products });
    }
});

// POST /add-product - Handles product submission for farmers only
app.post('/add-product', isAuthenticated, async (req, res) => {
    const { name, category, price, quantity } = req.body;
    const farmer_id = req.session.userId;
    
    // Ensure the user is a farmer before allowing them to add a product
    const user = await User.findByPk(farmer_id);
    if (user.role !== 'farmer') {
        return res.status(403).send('Only farmers can add products');
    }

    try {
        await Product.create({
            name,
            category,
            price,
            quantity,
            user_id: farmer_id,
        });

        res.redirect('home');
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).send('Error adding product.');
    }
});


// Dashboard route (protected)
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.redirect('/'); // You can create a dashboard.ejs view later
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

// Contact Routes
app.get('/contact', (req, res) => {
    const { message, redirect, errorType } = req.query;
    res.render('contact', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole,
        successMessage: message || "", // Display success message if available
        redirect: redirect === "true" // Convert redirect param to boolean
    });
});

app.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    
    try {
        // Here you would typically:
        // 1. Send an email
        // 2. Store the message in a database
        // 3. Send a notification to admin
        
        // For now, we'll just redirect with a success message
        try {
            const result = await connection.execute("INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)", [name, email, subject, message]);
            console.log('Message saved successfully');
        } catch (error) {
            console.error('Error saving message:', error);
        }
        res.redirect('/contact?message=Thank you for your message. We will get back to you soon!&redirect=true');
    } catch (error) {
        console.error('Contact form error:', error);
        res.redirect('/contact?error=There was an error sending your message. Please try again.');
    }
});

// Admin Routes
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [admin] = await connection.promise().query(
            'SELECT * FROM admin WHERE username = ?',
            [username]
        );

        if (admin.length === 0) {
            return res.render('admin-login', { error: 'Invalid username or password' });
        }

        // Compare password using bcrypt
        const isValidPassword = await bcrypt.compare(password, admin[0].password);
        
        if (isValidPassword) {
            req.session.isAdmin = true;
            res.redirect('/admin/dashboard');
        } else {
            res.render('admin-login', { error: 'Invalid username or password' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        res.render('admin-login', { error: 'An error occurred during login' });
    }
});

app.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        // Fetch messages
        const [messages] = await connection.promise().query(
            'SELECT * FROM contact_messages ORDER BY created_at DESC'
        );

        // Fetch products with user information
        const products = await Product.findAll({
            include: [{
                model: User,
                attributes: ['name']
            }]
        });

        // Fetch users
        const users = await User.findAll({
            attributes: ['id', 'name', 'email', 'role']
        });

        res.render('admin-dashboard', { 
            messages,
            products,
            users
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.render('admin-dashboard', { 
            messages: [],
            products: [],
            users: []
        });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

// Admin delete product route
app.delete('/admin/delete-product/:id', isAdmin, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Delete the product
        await Product.destroy({
            where: {
                product_id: productId
            }
        });
        
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Click here to open: http://localhost:${PORT}`);
}); 