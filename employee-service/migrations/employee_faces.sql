-- Face-recognition attendance: one registered face per employee.
-- The embedding is face-service's L2-normalised 512-d ArcFace vector, kept as
-- REAL[] (no pgvector needed) — matching is done in employee-service, scoped to
-- one branch, so it never scans more than that branch's staff.
CREATE TABLE IF NOT EXISTS tbl_employee_faces (
    face_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  UUID         NOT NULL REFERENCES tbl_employees(employee_id) ON DELETE CASCADE,
    zodu_id      VARCHAR(50)  NOT NULL,
    branch_id    VARCHAR(50)  NOT NULL,
    embedding    REAL[]       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_employee_faces_employee UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_faces_zodu_branch
    ON tbl_employee_faces(zodu_id, branch_id);
