CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(100) NOT NULL, email VARCHAR(255) UNIQUE, age INT);
INSERT INTO users VALUES (1, 'george', 'george@nexdb.dev', 25);
SELECT * FROM users WHERE id = 1;
CREATE INDEX idx_users_email ON users(email);
EXPLAIN SELECT * FROM users WHERE email = 'george@nexdb.dev';
