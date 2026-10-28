BEGIN;
CREATE TABLE IF NOT EXISTS action_evidences (
  id UUID PRIMARY KEY,
  "actionId" VARCHAR(80) NOT NULL REFERENCES corrective_actions(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL DEFAULT 'Documento',
  description VARCHAR(500) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  data TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS action_evidences_action ON action_evidences("actionId");
COMMIT;
