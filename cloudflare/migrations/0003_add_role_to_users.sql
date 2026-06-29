ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'founder', 'admin'));
CREATE INDEX idx_users_role ON users(role);
