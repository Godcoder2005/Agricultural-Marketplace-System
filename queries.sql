CREATE TABLE contact_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert admin user with credentials: username: Ramcharan, password: Lehari1104 (hashed)
INSERT INTO admin (username, password) VALUES ('Ramcharan', '$2a$10$pMwPIaiu04ysjSxPvJ.uAu9dI6T2NROf/k8oc/rNmqEsRAZ9i9zVa');

-- Insert admin user with credentials: username: Sharansai, password: Sharan630
INSERT INTO admin (username, password) VALUES ('Sharansai', '$2a$10$Qf9wBlR9Xm2aSJY9YGt0iONi5Tt/qCX3d4wLfOWZ6ltOcI8q6JxcW');
