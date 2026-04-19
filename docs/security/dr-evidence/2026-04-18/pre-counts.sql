SELECT 'orders' AS t, count(*) FROM orders
UNION ALL SELECT 'audit_log', count(*) FROM audit_log
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'order_items', count(*) FROM order_items;
