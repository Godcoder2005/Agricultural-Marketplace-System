const bcrypt = require('bcryptjs');

const password = 'Lehari1104';
bcrypt.hash(password, 10).then(hash => {
    console.log('Hashed password:', hash);
}); 