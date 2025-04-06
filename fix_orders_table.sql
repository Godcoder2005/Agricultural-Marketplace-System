USE agri_marketplace;

ALTER TABLE orders 
MODIFY COLUMN product_id INT NULL,
MODIFY COLUMN seller_id INT NULL,
MODIFY COLUMN quantity INT NULL; 