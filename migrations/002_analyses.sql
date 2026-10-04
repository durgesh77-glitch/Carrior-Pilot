CREATE TABLE career_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  target_role text NOT NULL,
  readiness_score numeric,
  current_level text,
  summary text,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  skill_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  roadmap jsonb NOT NULL DEFAULT '[]'::jsonb,
  courses jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)