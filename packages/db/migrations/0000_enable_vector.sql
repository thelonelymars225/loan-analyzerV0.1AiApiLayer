-- law_articles.embedding is vector(256), so pgvector must exist before the tables.
CREATE EXTENSION IF NOT EXISTS vector;
