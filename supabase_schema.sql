-- SQL para criar as tabelas no Supabase
-- Copie e cole isso no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR UNIQUE NOT NULL,
    hashed_password VARCHAR NOT NULL,
    full_name VARCHAR,
    club VARCHAR,
    role VARCHAR DEFAULT 'coach',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR NOT NULL,
    position VARCHAR,
    age INTEGER,
    photo_url VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS measurements (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metric_name VARCHAR NOT NULL,
    value FLOAT NOT NULL,
    unit VARCHAR,
    source VARCHAR -- 'csv', 'manual', 'device'
);

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    content TEXT, -- JSON ou Texto do relatório
    report_type VARCHAR -- 'technical', 'physical', 'tactical'
);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    message VARCHAR NOT NULL,
    severity VARCHAR DEFAULT 'medium', -- 'low', 'medium', 'high'
    is_read BOOLEAN DEFAULT FALSE
);
