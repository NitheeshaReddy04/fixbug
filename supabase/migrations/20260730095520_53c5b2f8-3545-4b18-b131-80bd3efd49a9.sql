DROP POLICY IF EXISTS "Users insert own followups" ON public.analysis_followups;
CREATE POLICY "Users insert own followups" ON public.analysis_followups
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = analysis_id AND a.user_id = auth.uid()
    )
  );