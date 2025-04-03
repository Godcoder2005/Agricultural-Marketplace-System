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
