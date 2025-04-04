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
const flash = require('express-flash');

const connection = mysql.createConnection({
    host: process.env.DB_HOST,  // Change if necessary
    user: process.env.DB_USER,       // Change to your DB user
    password: process.env.DB_PASSWORD,       // Change to your DB password
    database: process.env.DB_NAME // Change to your database name
});

app.use(flash());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure session with security options
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'strict'
    },
    name: 'sessionId',
}));

// Initialize flash after session
app.use(flash());

// Add middleware to make isLoggedIn available to all views and debug session
app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.userId;
    res.locals.userRole = req.session.userRole;
    res.locals.username = req.session.username;
    next();
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

// Authentication Middleware with debugging
const isAuthenticated = (req, res, next) => {
    console.log('Auth Check - Session:', req.session);
    if (req.session && req.session.userId) {
        next();
    } else {
        console.log('Auth Failed - No userId in session');
        req.session.returnTo = req.originalUrl;
        res.redirect('/login?message=Please login to continue');
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
    const returnTo = req.session.returnTo || '/dashboard';
    res.render('login', { 
        error: req.flash('error'),
        message: req.flash('success'),
        returnTo,
        isLoggedIn: !!req.session.userId
    });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const returnTo = req.session.returnTo || '/dashboard';

    try {
        const user = await User.findOne({ where: { email: email } });
        
        if (!user) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/login');
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        
        if (!isValidPassword) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/login');
        }

        // Set session
        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.username = user.name;

        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.flash('error', 'An error occurred during login');
                return res.redirect('/login');
            }

            // Set success message
            req.flash('success', 'Successfully logged in!');

            // Clear the returnTo from session
            const redirectTo = returnTo;
            req.session.returnTo = null;

            res.redirect(redirectTo);
        });
    } catch (error) {
        console.error('Login error:', error);
        req.flash('error', 'An error occurred during login');
        res.redirect('/login');
    }
});

// Shop route (protected)
app.get('/shop', isAuthenticated, async (req, res) => {
    try {
        console.log('Shop Route - Session:', req.session);
        
        if (!req.session || !req.session.userId) {
            console.log('Shop Route - No session or userId');
            return res.redirect('/login');
        }

        const user = await User.findByPk(req.session.userId);
        
        if (!user) {
            req.session.destroy((err) => {
                if (err) console.error('Session destroy error:', err);
                req.flash('error', 'User not found. Please login again.');
                res.redirect('/login');
            });
            return;
        }

        if (user.role === 'farmer') {
            // Render the page where farmers can add products
            res.render('farmer', {
                user: req.session.username,
                isLoggedIn: true,
                userRole: user.role
            });
        } else {
            // Fetch products for buyers
            const products = await Product.findAll({
                include: {
                    model: User,
                    attributes: ['email', 'name']
                }
            });
            res.render('buyer', {
                products,
                isLoggedIn: true,
                userRole: user.role,
                username: user.name
            });
        }
    } catch (error) {
        console.error('Shop route error:', error);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/login');
    }
});

// POST /add-product - Handles product submission for farmers only
app.post('/add-product', isAuthenticated, async (req, res) => {
    try {
        const { name, category, price, quantity } = req.body;
        const farmer_id = req.session.userId;
        
        // Ensure the user is a farmer before allowing them to add a product
        const user = await User.findByPk(farmer_id);
        
        if (!user) {
            req.flash('error', 'User not found. Please login again.');
            return res.redirect('/login');
        }

        if (user.role !== 'farmer') {
            req.flash('error', 'Only farmers can add products');
            return res.redirect('/shop');
        }

        await Product.create({
            name,
            category,
            price,
            quantity,
            user_id: farmer_id,
        });

        req.flash('success', 'Product added successfully!');
        res.redirect('/');
    } catch (error) {
        console.error('Error adding product:', error);
        req.flash('error', 'Error adding product. Please try again.');
        res.redirect('/shop');
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

app.get('/services',(req,res)=>{
    res.render('services');
})

// About Route
app.get('/about', (req, res) => {
    res.render('about', {
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole,
        username: req.session.username
    });
});

// Admin Routes
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        // Execute the query and get the rows directly
        const [rows] = await connection.promise().query(
            'SELECT * FROM admin WHERE username = ?',
            [username]
        );

        // Check if any admin user was found
        if (rows.length === 0) {
            return res.render('admin-login', { error: 'Invalid username or password' });
        }

        const admin = rows[0]; // Get the first row
        
        // Compare password using bcrypt
        const isValidPassword = await bcrypt.compare(password, admin.password);
        
        if (isValidPassword) {
            req.session.isAdmin = true;
            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;
            return res.redirect('/admin/dashboard');
        } else {
            return res.render('admin-login', { error: 'Invalid username or password' });
        }
    } catch (error) {
        console.error('Admin login error occurred');
        return res.render('admin-login', { error: 'An error occurred during login' });
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

// Terms of Service Route
app.get('/terms', (req, res) => {
    res.render('terms', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole 
    });
});

// Products Routes
app.get('/products', async (req, res) => {
    try {
        const products = await Product.findAll({
            include: [{
                model: User,
                attributes: ['name', 'email']
            }],
            order: [['createdAt', 'DESC']]
        });

        res.render('products', {
            products,
            isLoggedIn: !!req.session.userId,
            userRole: req.session.userRole,
            username: req.session.username
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        req.flash('error', 'Error loading products');
        res.redirect('/');
    }
});

app.get('/products/add', isAuthenticated, async (req, res) => {
    if (req.session.userRole !== 'farmer') {
        req.flash('error', 'Only farmers can add products');
        return res.redirect('/products');
    }
    res.render('add-product', {
        isLoggedIn: true,
        userRole: req.session.userRole,
        username: req.session.username
    });
});

app.post('/products/add', isAuthenticated, async (req, res) => {
    try {
        const { name, category, price, quantity } = req.body;
        
        if (!name || !category || !price || !quantity) {
            req.flash('error', 'All fields are required');
            return res.redirect('/products/add');
        }

        await Product.create({
            name,
            category,
            price: parseFloat(price),
            quantity: parseInt(quantity),
            user_id: req.session.userId
        });

        req.flash('success', 'Product added successfully');
        res.redirect('/products');
    } catch (error) {
        console.error('Error adding product:', error);
        req.flash('error', 'Error adding product');
        res.redirect('/products/add');
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Click here to open: http://localhost:${PORT}`);
}); 