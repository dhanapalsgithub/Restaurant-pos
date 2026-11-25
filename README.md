# Here are your Instructions
 backend
 python server.py

 frontend

 npm start


 உங்கள் டேட்டாபேஸில் உள்ள ஸ்டோர்கள் மற்றும் ஆர்டர்களைப் பார்க்கலாம்:

ஸ்டோர்களைப் பார்க்க:

SQL
SELECT * FROM stores;
மெனு ஐட்டங்களைப் பார்க்க:

SQL
SELECT * FROM menu_items;
ஆர்டர்களைப் பார்க்க:

SQL
SELECT * FROM orders;



to make new user - sql editor on neon console
SELECT * FROM stores;

INSERT INTO stores (id, store_name, username, password_hash, address, phone, gst_number, created_at)
VALUES (
    gen_random_uuid()::text, 
    'New Restaurant Name', 
    'newstore_user', 
    '$2b$12$YourBcryptHashedPasswordHere', -- பாஸ்வேர்டின் ஹேஷ் மதிப்பு
    'Chennai', 
    '9876543210', 
    '33AAAAA0000A1Z5', 
    NOW()
);
