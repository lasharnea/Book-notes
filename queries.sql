CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  date_read DATE,
  author TEXT,
  cover_id TEXT,
  cover_url TEXT
);