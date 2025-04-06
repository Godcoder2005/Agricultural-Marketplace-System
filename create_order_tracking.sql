USE agri_marketplace; 
CREATE TABLE order_tracking (
    tracking_id INT AUTO_INCREMENT PRIMARY KEY,
     order_id INT NOT NULL, 
     status VARCHAR(50) NOT NULL, 
     status_message TEXT, 
     updated_by VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE);
