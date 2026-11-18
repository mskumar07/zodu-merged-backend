-- checklist-v2-service · categories belong to the company, no global defaults
-- Each company creates, renames, recolours and deletes its own categories. The
-- five global defaults (zodu_id NULL) from V001 are gone: a company whose
-- checklists used one gets its own copy (same name and colour), so nothing
-- it already has changes. Re-runnable.

BEGIN;

INSERT INTO ckl.categories (zodu_id, name, color, icon, sort_order)
SELECT DISTINCT c.zodu_id, g.name, g.color, g.icon, g.sort_order
  FROM ckl.checklists c JOIN ckl.categories g ON g.id = c.category_id AND g.zodu_id IS NULL
ON CONFLICT DO NOTHING;   -- the company already has one by that name: it is reused below

UPDATE ckl.checklists c SET category_id = own.id
  FROM ckl.categories g, ckl.categories own
 WHERE g.id = c.category_id AND g.zodu_id IS NULL
   AND own.zodu_id = c.zodu_id AND lower(own.name) = lower(g.name);

-- runs keep their snapshot name; the id lets them show the company's colour
UPDATE ckl.runs r SET category_id = own.id
  FROM ckl.categories g, ckl.categories own
 WHERE g.id = r.category_id AND g.zodu_id IS NULL
   AND own.zodu_id = r.zodu_id AND lower(own.name) = lower(g.name);

DELETE FROM ckl.categories WHERE zodu_id IS NULL;
ALTER TABLE ckl.categories ALTER COLUMN zodu_id SET NOT NULL;

COMMIT;
