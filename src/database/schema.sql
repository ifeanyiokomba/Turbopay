-- TurboPay Database Schema
-- PostgreSQL migration for production use
-- Replaces JSON file persistence

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ADMIN USERS
-- =============================================================================

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  department VARCHAR(100),
  job_title VARCHAR(100),
  job_description TEXT,
  onboarding_status VARCHAR(20) DEFAULT 'pending',
  onboarding_completed_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '[]',
  reports_to UUID REFERENCES admin_users(id),
  is_active BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT true,
  requires_password_change BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- =============================================================================
-- CUSTOMER USERS
-- =============================================================================

CREATE TABLE customer_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  kyc_tier VARCHAR(10) DEFAULT 'tier_1',
  bvn_verified BOOLEAN DEFAULT false,
  nin_verified BOOLEAN DEFAULT false,
  bvn VARCHAR(20),
  nin VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT true,
  is_phone_verified BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE INDEX idx_customer_users_email ON customer_users(email);
CREATE INDEX idx_customer_users_phone ON customer_users(phone);

-- =============================================================================
-- SESSIONS
-- =============================================================================

CREATE TABLE admin_sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_sessions_user ON admin_sessions(user_id);
CREATE INDEX idx_customer_sessions_user ON customer_sessions(user_id);

-- =============================================================================
-- WALLETS & LEDGER
-- =============================================================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  user_type VARCHAR(20) NOT NULL, -- 'admin' or 'customer'
  currency VARCHAR(10) NOT NULL,
  balance DECIMAL(20, 4) DEFAULT 0,
  available_balance DECIMAL(20, 4) DEFAULT 0,
  held_balance DECIMAL(20, 4) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, user_type, currency)
);

CREATE INDEX idx_wallets_user ON wallets(user_id, user_type);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type VARCHAR(20) NOT NULL, -- credit, debit, hold, release, settlement, fee, refund, reversal, adjustment
  amount DECIMAL(20, 4) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reference VARCHAR(255) NOT NULL,
  provider VARCHAR(50),
  provider_reference VARCHAR(255),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  balance_before DECIMAL(20, 4) NOT NULL,
  balance_after DECIMAL(20, 4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX idx_ledger_reference ON ledger_entries(reference);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at);

-- =============================================================================
-- TRANSACTIONS
-- =============================================================================

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID,
  user_type VARCHAR(20),
  provider VARCHAR(50) NOT NULL,
  provider_reference VARCHAR(255),
  operation VARCHAR(50) NOT NULL,
  amount DECIMAL(20, 4) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  fee DECIMAL(20, 4) DEFAULT 0,
  status VARCHAR(20) NOT NULL,
  country VARCHAR(10),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_reference ON transactions(reference);
CREATE INDEX idx_transactions_user ON transactions(user_id, user_type);
CREATE INDEX idx_transactions_provider ON transactions(provider);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created ON transactions(created_at);

-- =============================================================================
-- PAYMENT LINKS
-- =============================================================================

CREATE TABLE payment_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL, -- fixed, flexible, subscription
  status VARCHAR(20) DEFAULT 'active',
  amount DECIMAL(20, 4),
  currency VARCHAR(10) NOT NULL,
  allow_custom_amount BOOLEAN DEFAULT false,
  min_amount DECIMAL(20, 4),
  max_amount DECIMAL(20, 4),
  interval VARCHAR(20), -- daily, weekly, monthly, yearly
  collect_customer_email BOOLEAN DEFAULT true,
  collect_customer_name BOOLEAN DEFAULT false,
  collect_customer_phone BOOLEAN DEFAULT false,
  success_url TEXT,
  cancel_url TEXT,
  metadata JSONB DEFAULT '{}',
  total_uses INTEGER DEFAULT 0,
  total_amount_collected DECIMAL(20, 4) DEFAULT 0,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  reference_prefix VARCHAR(100),
  slug VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_links_merchant ON payment_links(merchant_id);
CREATE INDEX idx_payment_links_slug ON payment_links(slug);
CREATE INDEX idx_payment_links_status ON payment_links(status);

CREATE TABLE payment_link_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id UUID NOT NULL REFERENCES payment_links(id),
  reference VARCHAR(255) UNIQUE NOT NULL,
  amount DECIMAL(20, 4) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  customer_email VARCHAR(255),
  customer_name VARCHAR(255),
  customer_phone VARCHAR(20),
  provider VARCHAR(50),
  provider_reference VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plink_txn_link ON payment_link_transactions(link_id);
CREATE INDEX idx_plink_txn_reference ON payment_link_transactions(reference);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  user_type VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  channels JSONB DEFAULT '["in_app"]',
  priority VARCHAR(20) DEFAULT 'normal',
  status JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  action_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user ON notifications(user_id, user_type);
CREATE INDEX idx_notifications_read ON notifications(read);

-- =============================================================================
-- COMPLIANCE & TRUST
-- =============================================================================

CREATE TABLE compliance_certifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  logo_url TEXT,
  verification_url TEXT,
  certificate_number VARCHAR(255),
  date_issued DATE,
  expiry_date DATE,
  display_on_homepage BOOLEAN DEFAULT false,
  display_priority INTEGER DEFAULT 0,
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE TABLE security_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  status VARCHAR(20) DEFAULT 'active',
  display_priority INTEGER DEFAULT 0,
  category VARCHAR(50),
  learn_more_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE provider_logos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_name VARCHAR(100) NOT NULL,
  logo_url TEXT NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  website_url TEXT,
  display_priority INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trust_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info',
  display_priority INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trust_indicators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  icon VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  learn_more_url TEXT,
  display_priority INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOG
-- =============================================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  actor VARCHAR(255),
  changes JSONB,
  metadata JSONB DEFAULT '{}',
  severity VARCHAR(20) DEFAULT 'info',
  ip_address VARCHAR(45),
  user_agent TEXT,
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_event ON audit_log(event);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- =============================================================================
-- EMAIL TEMPLATES
-- =============================================================================

CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- NOTIFICATION TEMPLATES
-- =============================================================================

CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  subject VARCHAR(500),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_users_updated_at BEFORE UPDATE ON customer_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payment_links_updated_at BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
