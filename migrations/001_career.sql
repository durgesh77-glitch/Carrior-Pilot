CREATE TABLE career_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  full_name text,
  current_position text,
  target_role text,
  education text,
  experience_years numeric DEFAULT 0,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  resume_text text,
  goals text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)