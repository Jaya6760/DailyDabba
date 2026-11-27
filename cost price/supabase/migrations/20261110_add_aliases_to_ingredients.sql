-- =========================================================================
-- Migration: Add dynamic aliases to ingredients table
-- Date: 2026-11-10
-- Purpose: Support database-backed custom aliases per ingredient
-- =========================================================================

-- 1. Add aliases array column if not present with empty array default
ALTER TABLE ingredients 
ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

-- 2. Create GIN index for high-performance array search and overlap queries
CREATE INDEX IF NOT EXISTS idx_ingredients_aliases 
ON ingredients USING GIN (aliases);

-- =========================================================================
-- Rollback Instructions (DO NOT EXECUTE UNLESS ROLLING BACK):
-- DROP INDEX IF EXISTS idx_ingredients_aliases;
-- ALTER TABLE ingredients DROP COLUMN IF EXISTS aliases;
-- =========================================================================

