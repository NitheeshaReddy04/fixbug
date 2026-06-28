CREATE TABLE public.analysis_followups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_followups_analysis_id_created_at_idx
  ON public.analysis_followups (analysis_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_followups TO authenticated;
GRANT ALL ON public.analysis_followups TO service_role;

ALTER TABLE public.analysis_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own followups" ON public.analysis_followups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own followups" ON public.analysis_followups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own followups" ON public.analysis_followups
  FOR DELETE TO authenticated USING (auth.uid() = user_id);