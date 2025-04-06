USE agri_marketplace;


ALTER TABLE orders 
ADD COLUMN is_multi_item BOOLEAN DEFAULT 0;

ALTER TABLE orders 
MODIFY product_id INT NULL,
MODIFY seller_id INT NULL, 
MODIFY quantity INT NULL; 