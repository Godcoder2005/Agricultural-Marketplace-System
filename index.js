require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const sequelize = require('./config/database');
const { Op } = require('sequelize');
const User = require('./models/User');
const Product = require('./models/products'); 
const Order = require('./models/Order');
const OrderItem = require('./models/OrderItem');
const bcrypt = require('bcryptjs');
const app = express();
const mysql = require('mysql2');
const flash = require('express-flash');

const connection = mysql.createConnection({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER,      
    password: process.env.DB_PASSWORD,     
    database: process.env.DB_NAME
});

app.use(flash());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.use(flash());

app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.userId;
    res.locals.userRole = req.session.userRole;
    res.locals.username = req.session.username;
    next();
});


async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        
        await sequelize.sync({ alter: true, force: false });
        console.log('Database models synchronized');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}
User.hasMany(Product, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Product.belongsTo(User, { foreignKey: 'user_id' });

Order.belongsTo(Product, { foreignKey: 'product_id' });
Order.belongsTo(User, { as: 'Buyer', foreignKey: 'buyer_id' });
Order.belongsTo(User, { as: 'Seller', foreignKey: 'seller_id' });

Order.hasMany(OrderItem, { foreignKey: 'order_id', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id' });
OrderItem.belongsTo(User, { as: 'Seller', foreignKey: 'seller_id' });

initializeDatabase();

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

const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.render('register', { error: 'Email already registered', message: null, returnTo });
        }

        const user = await User.create({
            name,
            email,
            password,
            role
        });

        req.session.userId = user.id;
        req.session.userRole = user.role;

        const redirectTo = returnTo;
        req.session.returnTo = null;

        res.redirect(redirectTo);
    } catch (error) {
        console.error('Registration error:', error);
        res.render('register', { error: 'An error occurred during registration', message: null, returnTo });
    }
});

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

        const isValidPassword = await user.comparePassword(password);
        
        if (!isValidPassword) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/login');
        }

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.username = user.name;

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.flash('error', 'An error occurred during login');
                return res.redirect('/login');
            }

            req.flash('success', 'Successfully logged in!');

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

            res.render('farmer', {
                user: req.session.username,
                isLoggedIn: true,
                userRole: user.role
            });
        } else {

            const products = await Product.findAll({
                include: {
                    model: User,
                    attributes: ['email', 'name']
                }
            });
 
            const [orderCountResult] = await connection.promise().query(
                'SELECT COUNT(*) as count FROM orders WHERE buyer_id = ?',
                [req.session.userId]
            );
            
            res.render('buyer', {
                products,
                isLoggedIn: true,
                userRole: user.role,
                username: user.name,
                orderCount: orderCountResult[0].count
            });
        }
    } catch (error) {
        console.error('Shop route error:', error);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/login');
    }
});

app.post('/add-product', isAuthenticated, async (req, res) => {
    try {
        const { name, category, price, quantity } = req.body;
        const farmer_id = req.session.userId;

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


app.get('/dashboard', isAuthenticated, (req, res) => {
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/', (req, res) => {
    res.render('home', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole 
    });
});

app.get('/contact', (req, res) => {
    const { message, redirect, errorType } = req.query;
    res.render('contact', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole,
        successMessage: message || "",
        redirect: redirect === "true" 
    });
});

app.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    
    try {
    
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

app.get('/about', (req, res) => {
    res.render('about', {
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole,
        username: req.session.username
    });
});

app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {

        const [rows] = await connection.promise().query(
            'SELECT * FROM admin WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.render('admin-login', { error: 'Invalid username or password' });
        }

        const admin = rows[0]; 
 
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
        const [orderStats] = await connection.promise().query(
            `SELECT 
                COUNT(*) as total_orders,
                SUM(total_price) as total_revenue,
                COUNT(DISTINCT CASE WHEN is_multi_item = 1 THEN order_id END) as multi_item_orders,
                COUNT(DISTINCT CASE WHEN is_multi_item = 0 THEN order_id END) as single_item_orders,
                COUNT(DISTINCT CASE WHEN order_status = 'pending' THEN order_id END) as pending_orders,
                COUNT(DISTINCT CASE WHEN order_status = 'processing' THEN order_id END) as processing_orders,
                COUNT(DISTINCT CASE WHEN order_status = 'shipped' THEN order_id END) as shipped_orders,
                COUNT(DISTINCT CASE WHEN order_status = 'delivered' THEN order_id END) as delivered_orders,
                COUNT(DISTINCT CASE WHEN order_status = 'cancelled' THEN order_id END) as cancelled_orders
            FROM orders`
        );

        const [userStats] = await connection.promise().query(
            `SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN role = 'buyer' THEN 1 END) as buyers,
                COUNT(CASE WHEN role = 'farmer' THEN 1 END) as farmers
            FROM users`
        );

        const [productStats] = await connection.promise().query(
            `SELECT 
                COUNT(*) as total_products,
                SUM(quantity) as total_inventory,
                COUNT(DISTINCT category) as categories,
                AVG(price) as avg_price
            FROM Products`
        );
 
        const [recentOrders] = await connection.promise().query(
            `SELECT o.*, 
            b.name as buyer_name,
            CASE WHEN o.is_multi_item = 1 THEN 'Multiple Items' ELSE p.name END as product_name
            FROM orders o 
            LEFT JOIN Products p ON o.product_id = p.product_id
            LEFT JOIN users b ON o.buyer_id = b.id
            ORDER BY o.createdAt DESC LIMIT 5`
        );
 
        const [popularProducts] = await connection.promise().query(
            `SELECT p.product_id, p.name, p.category, p.price, COUNT(o.order_id) as order_count, 
            SUM(CASE WHEN o.is_multi_item = 0 THEN o.quantity ELSE oi.quantity END) as quantity_sold,
            u.name as seller_name
            FROM Products p
            LEFT JOIN orders o ON p.product_id = o.product_id AND o.is_multi_item = 0
            LEFT JOIN order_items oi ON p.product_id = oi.product_id
            LEFT JOIN users u ON p.user_id = u.id
            GROUP BY p.product_id
            ORDER BY quantity_sold DESC
            LIMIT 5`
        );
        
        res.render('admin-dashboard', {
            orderStats: orderStats[0],
            userStats: userStats[0],
            productStats: productStats[0],
            recentOrders,
            popularProducts,
            isAdmin: true,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        req.flash('error', 'Error loading dashboard data');
        res.render('admin-dashboard', {
            orderStats: { total_orders: 0, total_revenue: 0 },
            userStats: { total_users: 0, buyers: 0, farmers: 0 },
            productStats: { total_products: 0, total_inventory: 0 },
            recentOrders: [],
            popularProducts: [],
            isAdmin: true,
            messages: req.flash()
        });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

app.delete('/admin/delete-product/:id', isAdmin, async (req, res) => {
    try {
        const productId = req.params.id;

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

app.delete('/admin/delete-user/:id', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Admin users cannot be deleted' });
        }

        await User.destroy({
            where: {
                id: userId
            }
        });
        
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/terms', (req, res) => {
    res.render('terms', { 
        isLoggedIn: !!req.session.userId,
        userRole: req.session.userRole 
    });
});

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
            username: req.session.username,
            messages: req.flash()
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
        const { name, category, price, quantity, description } = req.body;
        
        if (!name || !category || !price || !quantity) {
            req.flash('error', 'All fields are required');
            return res.redirect('/products/add');
        }

        await Product.create({
            name,
            category,
            price: parseFloat(price),
            quantity: parseInt(quantity),
            description: description || '',
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

app.get('/products/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;
        const product = await Product.findByPk(productId, {
            include: {
                model: User,
                attributes: ['name', 'email']
            }
        });

        if (!product) {
            req.flash('error', 'Product not found');
            return res.redirect('/products');
        }

        const relatedProducts = await Product.findAll({
            where: {
                category: product.category,
                product_id: {
                    [Op.ne]: productId 
                }
            },
            include: {
                model: User,
                attributes: ['name']
            },
            limit: 3
        });

        res.render('product-detail', {
            product,
            relatedProducts,
            isLoggedIn: !!req.session.userId,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Product detail route error:', error);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/products');
    }
});

app.get('/checkout/:productId', isAuthenticated, async (req, res) => {
    try {
        const productId = req.params.productId;
        const product = await Product.findByPk(productId, {
            include: {
                model: User,
                attributes: ['name', 'email']
            }
        });

        if (!product) {
            req.flash('error', 'Product not found');
            return res.redirect('/products');
        }

        res.render('checkout', {
            product,
            isLoggedIn: true,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Checkout route error:', error);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/products');
    }
});

app.get('/cart', async (req, res) => {
    try {
        res.render('cart', {
            isLoggedIn: !!req.session.userId,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Cart route error:', error);
        req.flash('error', 'An error occurred. Please try again.');
        res.redirect('/products');
    }
});

app.post('/submit-multi-order', isAuthenticated, async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { 
            items, 
            firstName, 
            lastName, 
            email, 
            phone, 
            address, 
            city, 
            pincode
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'No items in cart' });
        }

        let totalPrice = 0;
        const [orderResult] = await connection.promise().query(
            `INSERT INTO orders (
                product_id, seller_id, buyer_id, first_name, last_name, 
                email, phone, address, city, pincode, 
                quantity, total_price, payment_status, order_status, is_multi_item,
                createdAt, updatedAt
            ) VALUES (
                NULL, NULL, ?, ?, ?, 
                ?, ?, ?, ?, ?, 
                NULL, 0, 'completed', 'pending', 1,
                NOW(), NOW()
            )`,
            [
                req.session.userId, 
                firstName, lastName, 
                email, phone, address, city, pincode
            ]
        );
        
        const orderId = orderResult.insertId;

        for (const item of items) {

            const [products] = await connection.promise().query(
                'SELECT * FROM Products WHERE product_id = ?',
                [item.id]
            );
            
            if (!products || products.length === 0) {
                throw new Error(`Product with ID ${item.id} not found`);
            }
            
            const product = products[0];
            
            if (product.quantity < item.quantity) {
                throw new Error(`Not enough stock for product: ${product.name}`);
            }

            const itemTotal = product.price * item.quantity;
            totalPrice += itemTotal;

            await connection.promise().query(
                `INSERT INTO order_items (
                    order_id, product_id, seller_id, 
                    quantity, price, total_price,
                    createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    orderId, 
                    product.product_id, 
                    product.user_id,
                    item.quantity, 
                    product.price, 
                    itemTotal
                ]
            );

            await connection.promise().query(
                'UPDATE Products SET quantity = quantity - ? WHERE product_id = ?',
                [item.quantity, product.product_id]
            );
        }

        await connection.promise().query(
            'UPDATE orders SET total_price = ? WHERE order_id = ?',
            [totalPrice, orderId]
        );

        await connection.promise().query(
            'INSERT INTO order_tracking (order_id, status, status_message, updated_by) VALUES (?, ?, ?, ?)',
            [orderId, 'pending', 'Order has been received and is pending processing.', 'system']
        );

        await t.commit();
        
        res.json({ success: true, orderId: orderId });
    } catch (error) {

        await t.rollback();
        console.error('Error submitting multi-item order:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'An error occurred while processing your order' 
        });
    }
});

app.post('/submit-order', isAuthenticated, async (req, res) => {
    try {
        const { 
            productId, 
            firstName, 
            lastName, 
            email, 
            phone, 
            address, 
            city, 
            pincode, 
            quantity 
        } = req.body;

        const product = await Product.findByPk(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const totalPrice = product.price * quantity;
 
        const order = await Order.create({
            product_id: productId,
            buyer_id: req.session.userId,
            seller_id: product.user_id,
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone: phone,
            address: address,
            city: city,
            pincode: pincode,
            quantity: quantity,
            total_price: totalPrice,
            payment_status: 'completed',
            order_status: 'pending'
        });
 
        await Product.update(
            { quantity: product.quantity - quantity },
            { where: { product_id: productId } }
        );

        await connection.promise().query(
            'INSERT INTO order_tracking (order_id, status, status_message, updated_by) VALUES (?, ?, ?, ?)',
            [order.order_id, 'pending', 'Order has been received and is pending processing.', 'system']
        );
        
        res.json({ success: true, orderId: order.order_id });
    } catch (error) {
        console.error('Error submitting order:', error);
        res.status(500).json({ success: false, message: 'An error occurred while processing your order' });
    }
});

app.get('/orders', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        console.log('Fetching orders for user ID:', userId);

        const [rawOrders] = await connection.promise().query(
            `SELECT o.*, 
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE p.name END as product_name, 
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE p.category END as category, 
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE p.price END as price,
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE s.name END as seller_name
            FROM orders o 
            LEFT JOIN Products p ON o.product_id = p.product_id 
            LEFT JOIN users s ON o.seller_id = s.id 
            WHERE o.buyer_id = ? 
            ORDER BY o.createdAt DESC`,
            [userId]
        );

        const multiOrderIds = rawOrders.filter(o => o.is_multi_item === 1).map(o => o.order_id);
        let orderItems = [];
        
        if (multiOrderIds.length > 0) {
            const [items] = await connection.promise().query(
                `SELECT oi.*, 
                p.name as product_name, 
                p.category,
                u.name as seller_name, 
                u.email as seller_email
                FROM order_items oi 
                JOIN Products p ON oi.product_id = p.product_id 
                JOIN users u ON oi.seller_id = u.id 
                WHERE oi.order_id IN (?)`,
                [multiOrderIds]
            );
            
            orderItems = items;
        }

        const [orderStats] = await connection.promise().query(
            `SELECT 
                COUNT(*) as total_orders,
                SUM(total_price) as total_spent,
                COUNT(DISTINCT CASE WHEN is_multi_item = 1 THEN order_id END) as multi_item_orders,
                COUNT(DISTINCT CASE WHEN is_multi_item = 0 THEN order_id END) as single_item_orders
            FROM orders WHERE buyer_id = ?`,
            [userId]
        );

        const orders = rawOrders.map(order => {
 
            let items = [];
            if (order.is_multi_item === 1) {
                items = orderItems.filter(item => item.order_id === order.order_id).map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name,
                    category: item.category,
                    price: Number(item.price),
                    quantity: Number(item.quantity),
                    total_price: Number(item.total_price),
                    seller_name: item.seller_name,
                    seller_email: item.seller_email
                }));
            }
            
            return {
                order_id: order.order_id,
                quantity: Number(order.quantity || 0),
                total_price: Number(order.total_price),
                payment_status: order.payment_status,
                order_status: order.order_status,
                address: order.address,
                city: order.city,
                pincode: order.pincode,
                createdAt: order.createdAt,
                is_multi_item: order.is_multi_item === 1,
                Product: {
                    name: order.product_name,
                    category: order.category,
                    price: Number(order.price || 0)
                },
                Seller: {
                    name: order.seller_name
                },
                items: items
            };
        });
        
        res.render('orders', {
            orders: orders || [],
            orderStats: orderStats[0] || { 
                total_orders: 0, 
                total_spent: 0, 
                multi_item_orders: 0, 
                single_item_orders: 0 
            },
            isLoggedIn: true,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        req.flash('error', 'Error loading your orders');
        res.render('orders', {
            orders: [],
            orderStats: { 
                total_orders: 0, 
                total_spent: 0, 
                multi_item_orders: 0, 
                single_item_orders: 0 
            },
            isLoggedIn: true,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    }
});

app.get('/order-detail/:orderId', isAuthenticated, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.session.userId;
        
        console.log('Fetching order details for order ID:', orderId, 'and user ID:', userId);

        const [rawOrders] = await connection.promise().query(
            'SELECT o.*, p.name as product_name, p.category, p.price, p.description, u.name as seller_name, u.email as seller_email ' +
            'FROM orders o ' +
            'LEFT JOIN Products p ON o.product_id = p.product_id ' +
            'LEFT JOIN users u ON o.seller_id = u.id ' +
            'WHERE o.order_id = ? AND o.buyer_id = ? ' +
            'LIMIT 1',
            [orderId, userId]
        );
        
        if (rawOrders.length === 0) {
            console.log('Order not found or access denied');
            req.flash('error', 'Order not found or access denied');
            return res.redirect('/orders');
        }
        
        console.log('Found order details');

        const rawOrder = rawOrders[0];
        const order = {
            order_id: rawOrder.order_id,
            buyer_id: rawOrder.buyer_id,
            seller_id: rawOrder.seller_id,
            first_name: rawOrder.first_name,
            last_name: rawOrder.last_name,
            email: rawOrder.email,
            phone: rawOrder.phone,
            address: rawOrder.address,
            city: rawOrder.city,
            pincode: rawOrder.pincode,
            quantity: Number(rawOrder.quantity || 0),
            total_price: Number(rawOrder.total_price),
            payment_status: rawOrder.payment_status,
            order_status: rawOrder.order_status,
            createdAt: rawOrder.createdAt,
            updatedAt: rawOrder.updatedAt,
            is_multi_item: rawOrder.is_multi_item === 1,
            Product: {
                name: rawOrder.product_name,
                category: rawOrder.category,
                price: Number(rawOrder.price || 0),
                description: rawOrder.description
            },
            Seller: {
                name: rawOrder.seller_name,
                email: rawOrder.seller_email
            },
            items: []
        };

        if (order.is_multi_item) {
            const [orderItems] = await connection.promise().query(
                'SELECT oi.*, p.name as product_name, p.category, p.description, u.name as seller_name, u.email as seller_email ' +
                'FROM order_items oi ' +
                'LEFT JOIN Products p ON oi.product_id = p.product_id ' +
                'LEFT JOIN users u ON oi.seller_id = u.id ' +
                'WHERE oi.order_id = ?',
                [orderId]
            );
            
            order.items = orderItems.map(item => ({
                item_id: item.item_id,
                product_id: item.product_id,
                quantity: Number(item.quantity),
                price: Number(item.price),
                total_price: Number(item.total_price),
                Product: {
                    name: item.product_name,
                    category: item.category,
                    description: item.description
                },
                Seller: {
                    name: item.seller_name,
                    email: item.seller_email
                }
            }));
        }
        
        res.render('order-detail', {
            order,
            isLoggedIn: true,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        req.flash('error', 'Error loading order details');
        res.redirect('/orders');
    }
});


app.get('/admin/orders', isAdmin, async (req, res) => {
    try {

        const [orders] = await connection.promise().query(
            `SELECT o.*, 
            b.name as buyer_name, b.email as buyer_email,
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE p.name END as product_name,
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE p.category END as category,
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE s.name END as seller_name,
            CASE WHEN o.is_multi_item = 1 THEN NULL ELSE s.email END as seller_email
            FROM orders o 
            LEFT JOIN Products p ON o.product_id = p.product_id 
            LEFT JOIN users b ON o.buyer_id = b.id
            LEFT JOIN users s ON o.seller_id = s.id
            ORDER BY o.createdAt DESC`
        );

        const multiOrderIds = orders.filter(o => o.is_multi_item === 1).map(o => o.order_id);
        let orderItems = [];
        
        if (multiOrderIds.length > 0) {
            const [items] = await connection.promise().query(
                `SELECT oi.*, 
                p.name as product_name, p.category,
                u.name as seller_name, u.email as seller_email
                FROM order_items oi 
                JOIN Products p ON oi.product_id = p.product_id 
                JOIN users u ON oi.seller_id = u.id 
                WHERE oi.order_id IN (?)`,
                [multiOrderIds]
            );
            
            orderItems = items;
        }

        const formattedOrders = orders.map(order => {
            let items = [];
            if (order.is_multi_item === 1) {
                items = orderItems.filter(item => item.order_id === order.order_id).map(item => ({
                    product_name: item.product_name,
                    category: item.category,
                    quantity: Number(item.quantity),
                    price: Number(item.price),
                    total_price: Number(item.total_price),
                    seller_name: item.seller_name,
                    seller_email: item.seller_email
                }));
            }
            
            return {
                ...order,
                is_multi_item: order.is_multi_item === 1,
                items: items
            };
        });
        
        res.render('admin-orders', { 
            orders: formattedOrders,
            messages: req.flash()
        });
    } catch (err) {
        console.error('Error getting admin orders:', err);
        req.flash('error', 'Failed to load orders');
        res.redirect('/admin/dashboard');
    }
});

app.post('/admin/orders/:orderId/update-status', isAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { order_status } = req.body;
        const adminUsername = req.session.adminUsername || 'admin';

        console.log('Order status update request:', {
            orderId,
            order_status,
            body: req.body,
            contentType: req.headers['content-type']
        });

        if (!order_status) {
            console.error('Missing order_status in request body');
            req.flash('error', 'Missing order status');
            return res.redirect('/admin/orders');
        }

        const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
        if (!validStatuses.includes(order_status)) {
            console.error(`Invalid order status: ${order_status}`);
            req.flash('error', 'Invalid order status');
            return res.redirect('/admin/orders');
        }

        const [result] = await connection.promise().query(
            'UPDATE orders SET order_status = ? WHERE order_id = ?',
            [order_status, orderId]
        );
        
        console.log('Database update result:', {
            affectedRows: result.affectedRows,
            changedRows: result.changedRows,
            orderId,
            newStatus: order_status
        });
        
        if (result.affectedRows === 0) {
            req.flash('error', 'Order not found');
            return res.redirect('/admin/orders');
        }
 
        const statusMessages = {
            'pending': 'Order has been received and is pending processing.',
            'processing': 'Order is being processed.',
            'shipped': 'Order has been shipped.',
            'delivered': 'Order has been delivered to the customer.',
            'cancelled': 'Order has been cancelled.'
        };
        
        const statusMessage = statusMessages[order_status] || `Status changed to ${order_status}`;
        
        await connection.promise().query(
            'INSERT INTO order_tracking (order_id, status, status_message, updated_by) VALUES (?, ?, ?, ?)',
            [orderId, order_status, statusMessage, adminUsername]
        );
        
        req.flash('success', `Order #${orderId} status updated to ${order_status}`);
        return res.redirect('/admin/orders');
    } catch (error) {
        console.error('Error updating order status:', error);
        req.flash('error', 'Error updating order status: ' + error.message);
        return res.redirect('/admin/orders');
    }
});

app.get('/admin/order-tracking/:orderId', isAdmin, async (req, res) => {
    try {
        const orderId = req.params.orderId;

        const [orderDetails] = await connection.promise().query(
            'SELECT o.*, p.name as product_name, ' +
            'buyer.name as buyer_name, buyer.email as buyer_email ' +
            'FROM orders o ' +
            'LEFT JOIN Products p ON o.product_id = p.product_id ' +
            'LEFT JOIN users buyer ON o.buyer_id = buyer.id ' +
            'WHERE o.order_id = ?',
            [orderId]
        );
        
        if (orderDetails.length === 0) {
            req.flash('error', 'Order not found');
            return res.redirect('/admin/orders');
        }
 
        const [trackingHistory] = await connection.promise().query(
            'SELECT * FROM order_tracking WHERE order_id = ? ORDER BY created_at DESC',
            [orderId]
        );
        
        res.render('admin-order-tracking', {
            order: orderDetails[0],
            trackingHistory,
            isAdmin: true,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching order tracking history:', error);
        req.flash('error', 'Error loading tracking history');
        res.redirect('/admin/orders');
    }
});

app.get('/order-tracking/:orderId', isAuthenticated, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.session.userId;

        const [orderDetails] = await connection.promise().query(
            'SELECT o.*, p.name as product_name ' +
            'FROM orders o ' +
            'LEFT JOIN Products p ON o.product_id = p.product_id ' +
            'WHERE o.order_id = ? AND o.buyer_id = ?',
            [orderId, userId]
        );
        
        if (orderDetails.length === 0) {
            req.flash('error', 'Order not found or access denied');
            return res.redirect('/orders');
        }

        const [trackingHistory] = await connection.promise().query(
            'SELECT * FROM order_tracking WHERE order_id = ? ORDER BY created_at DESC',
            [orderId]
        );
        
        res.render('order-tracking', {
            order: orderDetails[0],
            trackingHistory,
            isLoggedIn: true,
            userRole: req.session.userRole,
            username: req.session.username,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error fetching order tracking history:', error);
        req.flash('error', 'Error loading tracking history');
        res.redirect('/orders');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Click here to open: http://localhost:${PORT}`);
}); 