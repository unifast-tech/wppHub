CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
UPDATE users SET status = 'approved' WHERE status IS NULL;
UPDATE users SET role = 'admin', status = 'approved' WHERE lower(email) = 'admin@unifast.com.br';

CREATE TABLE IF NOT EXISTS account_departments (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('hub', 'official')),
  account_id TEXT NOT NULL,
  account_name TEXT,
  department TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel, account_id),
  CHECK (department IN ('Comercial B2C', 'Comercial B2B', 'Secretaria', 'Financeiro', 'Coordenação', 'Administrativo'))
);

CREATE TABLE IF NOT EXISTS bitrix_conversations (
  id BIGSERIAL PRIMARY KEY,
  bitrix_portal TEXT NOT NULL,
  bitrix_deal_id TEXT NOT NULL,
  bitrix_contact_id TEXT NOT NULL,
  conversation_id TEXT,
  phone TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bitrix_portal, bitrix_deal_id)
);

CREATE INDEX IF NOT EXISTS bitrix_conversations_phone_idx ON bitrix_conversations(phone);
