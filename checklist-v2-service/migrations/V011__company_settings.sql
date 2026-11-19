-- checklist-v2-service · checklist settings and notification rules for the whole company
-- "Require photo proof", "Allow partial submission", "Allow notes" and the
-- notifications & escalation rules used to be chosen on every checklist. They are
-- now one set per company (every branch shares it, like categories), edited in
-- Settings. Saving it rewrites each checklist's own columns and checklist_rules,
-- so generation and the rule engine (V003, V005, V010) keep reading those.
-- A company without a row uses the defaults in src/services/settings.js. Re-runnable.

CREATE TABLE IF NOT EXISTS ckl.company_settings (
  zodu_id             varchar(50)  PRIMARY KEY,
  require_photo       boolean      NOT NULL DEFAULT true,
  allow_partial       boolean      NOT NULL DEFAULT true,
  allow_notes         boolean      NOT NULL DEFAULT true,
  -- normalised rules (rule_type, offset_min, threshold, target, channels, is_active)
  rules               jsonb        NOT NULL DEFAULT '[]',
  row_version         integer      NOT NULL DEFAULT 1,
  updated_by_user_id  uuid,
  updated_by_name     varchar(100),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_company_rules_array CHECK (jsonb_typeof(rules) = 'array')
);

DROP TRIGGER IF EXISTS trg_company_settings_touch ON ckl.company_settings;
CREATE TRIGGER trg_company_settings_touch BEFORE UPDATE ON ckl.company_settings
  FOR EACH ROW EXECUTE FUNCTION ckl.trg_touch_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ckl_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ckl.company_settings TO ckl_app;
  END IF;
END $$;
