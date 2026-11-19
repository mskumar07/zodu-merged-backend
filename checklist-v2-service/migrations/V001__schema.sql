-- checklist-v2-service · schema (tables, indexes)
-- Design: docs/checklist-v2/ARCHITECTURE.md §4.3. Re-runnable.

CREATE SCHEMA IF NOT EXISTS ckl;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() on PG < 13

-- ── shared trigger: updated_at ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ckl.trg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ── 1. categories (each company's own) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id     varchar(50),
  name        varchar(60)  NOT NULL,
  color       char(7)      NOT NULL DEFAULT '#1D4ED8',
  icon        varchar(40),
  sort_order  smallint     NOT NULL DEFAULT 0,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name ON ckl.categories (COALESCE(zodu_id, ''), lower(name));
-- No seeded defaults: each company creates its own (V009 makes zodu_id NOT NULL).

-- ── 2. per-branch code counter: CL-0001 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_code_counters (
  zodu_id   varchar(50) NOT NULL,
  branch_id varchar(50) NOT NULL,
  last_no   integer     NOT NULL,
  PRIMARY KEY (zodu_id, branch_id)
);

-- ── 3. checklists (the definition / template) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklists (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id               varchar(50)  NOT NULL,
  branch_id             varchar(50)  NOT NULL,
  code                  varchar(20)  NOT NULL,
  name                  varchar(150) NOT NULL,
  description           text,
  category_id           uuid REFERENCES ckl.categories(id),
  priority              varchar(6)   NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  status                varchar(8)   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  assign_mode           varchar(8)   NOT NULL CHECK (assign_mode IN ('ALL','SPECIFIC')),
  reviewer_employee_id  uuid,
  timezone              varchar(64)  NOT NULL DEFAULT 'Asia/Kolkata',
  require_photo         boolean      NOT NULL DEFAULT true,
  allow_partial         boolean      NOT NULL DEFAULT true,
  allow_notes           boolean      NOT NULL DEFAULT true,
  created_by_user_id    uuid         NOT NULL,
  created_by_name       varchar(100) NOT NULL,
  updated_by_user_id    uuid,
  updated_by_name       varchar(100),
  row_version           integer      NOT NULL DEFAULT 1,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT uq_checklists_code UNIQUE (zodu_id, branch_id, code)
);
CREATE INDEX IF NOT EXISTS idx_checklists_tenant ON ckl.checklists (zodu_id, branch_id, status) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_checklists_touch ON ckl.checklists;
CREATE TRIGGER trg_checklists_touch BEFORE UPDATE ON ckl.checklists
  FOR EACH ROW EXECUTE FUNCTION ckl.trg_touch_updated_at();

-- ── 4. tasks (the items of a checklist; runs copy them) ─────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id   uuid NOT NULL REFERENCES ckl.checklists(id) ON DELETE CASCADE,
  position       smallint     NOT NULL CHECK (position BETWEEN 1 AND 50),
  title          varchar(300) NOT NULL,
  instructions   text,
  require_photo  boolean NOT NULL DEFAULT false,
  allow_notes    boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_tasks_position UNIQUE (checklist_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- ── 5. schedule (1:1 with the frontend Recurrence type) ────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_schedules (
  checklist_id          uuid PRIMARY KEY REFERENCES ckl.checklists(id) ON DELETE CASCADE,
  task_type             varchar(10) NOT NULL CHECK (task_type IN ('ONCE','RECURRING')),
  frequency             varchar(8)  CHECK (frequency IN ('HOURLY','DAILY','WEEKLY','MONTHLY')),
  every_n               smallint    NOT NULL DEFAULT 1 CHECK (every_n BETWEEN 1 AND 99),
  all_day               boolean     NOT NULL DEFAULT false,
  window_start          time,
  window_end            time,
  weekdays_only         boolean     NOT NULL DEFAULT false,
  weekdays              smallint[]  NOT NULL DEFAULT '{}' CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  monthly_by            varchar(8)  CHECK (monthly_by IN ('DAY','WEEKDAY')),
  month_day             smallint    CHECK (month_day BETWEEN 1 AND 31),
  nth                   smallint    CHECK (nth IN (1,2,3,4,-1)),
  nth_weekday           smallint    CHECK (nth_weekday BETWEEN 0 AND 6),
  trigger_time          time,
  start_date            date        NOT NULL,
  ends                  varchar(8)  NOT NULL DEFAULT 'NEVER' CHECK (ends IN ('NEVER','AFTER','ON_DATE')),
  max_occurrences       integer     CHECK (max_occurrences BETWEEN 1 AND 999),
  end_date              date,
  -- generation state (owned by ckl.fn_generate_for_schedule)
  generated_until       timestamptz,          -- every slot <= this is generated or deliberately skipped
  occurrences_generated integer     NOT NULL DEFAULT 0,
  is_exhausted          boolean     NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- cross-field rules (mirror recurrenceErrors() in recurrence.ts)
  CONSTRAINT ck_freq_required    CHECK (task_type = 'ONCE' OR frequency IS NOT NULL),
  CONSTRAINT ck_time_required    CHECK (frequency = 'HOURLY' AND task_type = 'RECURRING' OR trigger_time IS NOT NULL),
  CONSTRAINT ck_hourly_window    CHECK (NOT (task_type = 'RECURRING' AND frequency = 'HOURLY' AND NOT all_day)
                                        OR (window_start IS NOT NULL AND window_end > window_start)),
  CONSTRAINT ck_hourly_every     CHECK (frequency IS DISTINCT FROM 'HOURLY' OR every_n <= 23),
  CONSTRAINT ck_weekly_days      CHECK (task_type = 'ONCE' OR frequency IS DISTINCT FROM 'WEEKLY' OR cardinality(weekdays) > 0),
  CONSTRAINT ck_monthly_pattern  CHECK (task_type = 'ONCE' OR frequency IS DISTINCT FROM 'MONTHLY'
                                        OR (monthly_by = 'DAY' AND month_day IS NOT NULL)
                                        OR (monthly_by = 'WEEKDAY' AND nth IS NOT NULL AND nth_weekday IS NOT NULL)),
  CONSTRAINT ck_ends_after       CHECK (ends <> 'AFTER'   OR max_occurrences IS NOT NULL),
  CONSTRAINT ck_ends_on_date     CHECK (ends <> 'ON_DATE' OR (end_date IS NOT NULL AND end_date >= start_date))
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON ckl.checklist_schedules (generated_until NULLS FIRST) WHERE NOT is_exhausted;

-- ── 6. specific assignees ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_assignees (
  checklist_id  uuid NOT NULL REFERENCES ckl.checklists(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL,
  PRIMARY KEY (checklist_id, employee_id)
);

-- ── 7. rules (§6) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id         uuid NOT NULL REFERENCES ckl.checklists(id) ON DELETE CASCADE,
  rule_type            varchar(30) NOT NULL CHECK (rule_type IN (
                         'REMIND_BEFORE_DUE','NOTIFY_ON_OVERDUE','ESCALATE_AFTER_OVERDUE','AUTO_CLOSE',
                         'NOTIFY_REVIEWER_ON_SUBMIT','NOTIFY_ON_COMPLETE','MISSED_STREAK')),
  offset_min           integer  NOT NULL DEFAULT 0 CHECK (offset_min BETWEEN 0 AND 10080),
  threshold            smallint CHECK (threshold BETWEEN 2 AND 30),
  target               varchar(10) NOT NULL DEFAULT 'ASSIGNEE' CHECK (target IN ('ASSIGNEE','REVIEWER','CREATOR','CUSTOM')),
  target_employee_ids  uuid[]   NOT NULL DEFAULT '{}',
  channels             varchar(10)[] NOT NULL DEFAULT '{IN_APP}'
                         CHECK (channels <@ ARRAY['IN_APP','WEB_PUSH','EMAIL']::varchar[]),
  is_active            boolean  NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_streak_threshold CHECK (rule_type <> 'MISSED_STREAK' OR threshold IS NOT NULL),
  CONSTRAINT ck_custom_targets   CHECK (target <> 'CUSTOM' OR cardinality(target_employee_ids) > 0),
  CONSTRAINT uq_rule UNIQUE (checklist_id, rule_type, offset_min, target)
);
CREATE INDEX IF NOT EXISTS idx_rules_checklist ON ckl.checklist_rules (checklist_id) WHERE is_active;

-- ── 8. images on a checklist (stored in file-service) ──────────────────────
CREATE TABLE IF NOT EXISTS ckl.checklist_images (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id         uuid NOT NULL REFERENCES ckl.checklists(id) ON DELETE CASCADE,
  file_id              varchar(100) NOT NULL,
  file_name            varchar(255) NOT NULL,
  position             smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  uploaded_by_user_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_image_position UNIQUE (checklist_id, position)
);

-- ── 9. employee directory (read model synced from employee-service) ────────
CREATE TABLE IF NOT EXISTS ckl.employee_directory (
  zodu_id            varchar(50)  NOT NULL,
  branch_id          varchar(50)  NOT NULL,
  employee_id        uuid         NOT NULL,
  user_id            uuid,                      -- NULL = employee without a login (gets runs, no notifications)
  employee_name      varchar(100) NOT NULL,
  is_active          boolean      NOT NULL DEFAULT true,
  source_updated_at  timestamptz,
  synced_at          timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (zodu_id, branch_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_directory_user ON ckl.employee_directory (user_id, zodu_id, branch_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ckl.directory_sync_state (
  zodu_id            varchar(50) NOT NULL,
  branch_id          varchar(50) NOT NULL,
  last_success_at    timestamptz,
  last_full_sync_at  timestamptz,
  cursor_updated_at  timestamptz,
  last_error         text,
  PRIMARY KEY (zodu_id, branch_id)
);

-- ── 10. runs (one per checklist × slot × assignee) ─────────────────────────
CREATE TABLE IF NOT EXISTS ckl.runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id                  varchar(50)  NOT NULL,
  branch_id                varchar(50)  NOT NULL,
  checklist_id             uuid NOT NULL REFERENCES ckl.checklists(id),
  slot_at                  timestamptz  NOT NULL,        -- the trigger moment
  run_date                 date         NOT NULL,        -- local day of slot_at (board filter)
  sequence_no              integer      NOT NULL,
  assignee_employee_id     uuid         NOT NULL,
  assignee_name            varchar(100) NOT NULL,
  -- snapshot of the definition at generation time
  title                    varchar(150) NOT NULL,
  description              text,
  category_id              uuid,
  category_name            varchar(60),
  priority                 varchar(6)   NOT NULL,
  frequency                varchar(8)   NOT NULL,        -- HOURLY..MONTHLY | ONE_TIME
  reviewer_employee_id     uuid,
  requires_review          boolean      NOT NULL DEFAULT false,
  allow_partial            boolean      NOT NULL DEFAULT true,
  available_at             timestamptz  NOT NULL,
  due_at                   timestamptz  NOT NULL,
  -- state
  status                   varchar(16)  NOT NULL DEFAULT 'TODO'
                             CHECK (status IN ('TODO','IN_PROGRESS','PENDING_REVIEW','COMPLETED','MISSED','CANCELLED')),
  total_items              smallint     NOT NULL DEFAULT 0,
  done_items               smallint     NOT NULL DEFAULT 0 CHECK (done_items <= total_items),
  started_at               timestamptz,
  submitted_at             timestamptz,
  completed_at             timestamptz,
  reviewed_at              timestamptz,
  reviewed_by_employee_id  uuid,
  review_comment           varchar(1000),
  rejected_count           smallint     NOT NULL DEFAULT 0,
  row_version              integer      NOT NULL DEFAULT 1,
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_run_slot UNIQUE (checklist_id, slot_at, assignee_employee_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_board        ON ckl.runs (zodu_id, branch_id, run_date);
CREATE INDEX IF NOT EXISTS idx_runs_my_board     ON ckl.runs (zodu_id, branch_id, assignee_employee_id, run_date);
CREATE INDEX IF NOT EXISTS idx_runs_open_due     ON ckl.runs (due_at) WHERE status IN ('TODO','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_runs_streak       ON ckl.runs (checklist_id, assignee_employee_id, slot_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_review_queue ON ckl.runs (zodu_id, branch_id, reviewer_employee_id) WHERE status = 'PENDING_REVIEW';
DROP TRIGGER IF EXISTS trg_runs_touch ON ckl.runs;
CREATE TRIGGER trg_runs_touch BEFORE UPDATE ON ckl.runs
  FOR EACH ROW EXECUTE FUNCTION ckl.trg_touch_updated_at();

CREATE TABLE IF NOT EXISTS ckl.run_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES ckl.runs(id) ON DELETE CASCADE,
  position              smallint     NOT NULL,
  title                 varchar(300) NOT NULL,
  instructions          text,
  require_photo         boolean NOT NULL DEFAULT false,
  allow_notes           boolean NOT NULL DEFAULT true,
  is_done               boolean NOT NULL DEFAULT false,
  note                  varchar(1000),
  done_at               timestamptz,
  done_by_employee_id   uuid,
  CONSTRAINT uq_run_item_position UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS ckl.run_item_photos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_item_id          uuid NOT NULL REFERENCES ckl.run_items(id) ON DELETE CASCADE,
  file_id              varchar(100) NOT NULL,
  file_name            varchar(255) NOT NULL,
  uploaded_by_user_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_photos_item ON ckl.run_item_photos (run_item_id);

CREATE TABLE IF NOT EXISTS ckl.run_events (
  id             bigserial PRIMARY KEY,
  run_id         uuid NOT NULL REFERENCES ckl.runs(id) ON DELETE CASCADE,
  zodu_id        varchar(50) NOT NULL,
  branch_id      varchar(50) NOT NULL,
  event_type     varchar(20) NOT NULL,   -- STATUS_CHANGED | REASSIGNED | ITEM_DONE | ITEM_UNDONE | NOTE | PHOTO_ADDED
  from_status    varchar(16),
  to_status      varchar(16),
  actor_user_id  uuid,                    -- NULL = system (scheduler / rule)
  payload        jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON ckl.run_events (run_id, created_at);

-- ── 11. rule firing ledger (exactly-once per rule × run) ───────────────────
CREATE TABLE IF NOT EXISTS ckl.rule_firings (
  rule_id   uuid NOT NULL REFERENCES ckl.checklist_rules(id) ON DELETE CASCADE,
  run_id    uuid NOT NULL REFERENCES ckl.runs(id) ON DELETE CASCADE,
  fired_at  timestamptz NOT NULL DEFAULT now(),
  error     text,
  PRIMARY KEY (rule_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_rule_firings_run ON ckl.rule_firings (run_id);

-- ── 12. notifications (in-app inbox) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id            varchar(50) NOT NULL,
  branch_id          varchar(50) NOT NULL,
  recipient_user_id  uuid        NOT NULL,
  type               varchar(30) NOT NULL,
  severity           varchar(8)  NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  title              varchar(200) NOT NULL,
  body               varchar(500) NOT NULL,
  entity_type        varchar(20),
  entity_id          uuid,
  action_url         varchar(300),
  data               jsonb NOT NULL DEFAULT '{}',
  dedupe_key         varchar(200) NOT NULL,
  show_in_inbox      boolean NOT NULL DEFAULT true,
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '90 days',
  CONSTRAINT uq_notification_dedupe UNIQUE (recipient_user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox  ON ckl.notifications (recipient_user_id, zodu_id, branch_id, created_at DESC, id DESC) WHERE show_in_inbox;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON ckl.notifications (recipient_user_id, zodu_id, branch_id) WHERE show_in_inbox AND read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_expiry ON ckl.notifications (expires_at);

-- ── 13. outbox for external channels (phase 2 delivery) ────────────────────
CREATE TABLE IF NOT EXISTS ckl.notification_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  uuid NOT NULL REFERENCES ckl.notifications(id) ON DELETE CASCADE,
  channel          varchar(10) NOT NULL CHECK (channel IN ('WEB_PUSH','EMAIL')),
  status           varchar(8)  NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED','DEAD')),
  attempts         smallint    NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  CONSTRAINT uq_delivery UNIQUE (notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON ckl.notification_deliveries (next_attempt_at) WHERE status IN ('PENDING','SENDING');

-- ── 14. preferences ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.notification_preferences (
  zodu_id  varchar(50) NOT NULL,
  user_id  uuid        NOT NULL,
  type     varchar(30) NOT NULL,
  channel  varchar(10) NOT NULL CHECK (channel IN ('IN_APP','WEB_PUSH','EMAIL')),
  enabled  boolean     NOT NULL,
  PRIMARY KEY (zodu_id, user_id, type, channel)
);

CREATE TABLE IF NOT EXISTS ckl.notification_settings (
  zodu_id      varchar(50) NOT NULL,
  user_id      uuid        NOT NULL,
  timezone     varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
  quiet_start  time,
  quiet_end    time,
  muted_until  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zodu_id, user_id)
);

CREATE TABLE IF NOT EXISTS ckl.push_subscriptions (           -- phase 2
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zodu_id       varchar(50) NOT NULL,
  user_id       uuid        NOT NULL,
  endpoint      text        NOT NULL UNIQUE,
  p256dh        text        NOT NULL,
  auth          text        NOT NULL,
  user_agent    varchar(300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_user ON ckl.push_subscriptions (user_id, zodu_id);

-- ── 15. API idempotency & job bookkeeping ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ckl.idempotency_keys (
  key              varchar(80) NOT NULL,
  user_id          uuid        NOT NULL,
  request_hash     char(64)    NOT NULL,
  response_status  smallint,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS ckl.job_state (
  job               varchar(30) PRIMARY KEY,
  last_run_at       timestamptz NOT NULL,
  last_duration_ms  integer,
  stats             jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ckl.job_errors (
  id          bigserial PRIMARY KEY,
  job         varchar(30) NOT NULL,
  entity_id   uuid,
  error       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_errors_created ON ckl.job_errors (created_at DESC);
