-- Atlas Identity Intelligence - identity matching provenance completion
-- Layered on 0001..0005.
--
-- Every recorded candidate must answer "where did this come from?" without
-- ambiguity. 0004 added media/face/track/matched-at context; this migration
-- completes the chain for the real external-provider flow:
--
--   provider_candidate_id - the upstream provider's own identifier for the
--                           candidate (distinct from our row id and from
--                           external_reference)
--   search_run_id         - the durable search_runs correlation: matching now
--                           walks the queued -> running -> completed |
--                           no_results | failed lifecycle, so every match
--                           attempt (including failures) leaves a trace
--   raw_fingerprint       - SHA-256 hex over the canonical JSON of the raw
--                           provider candidate object; tamper DETECTION for
--                           what the provider actually returned (never a
--                           claim of authenticity)

alter table identity_candidates
  add column if not exists provider_candidate_id text,
  add column if not exists search_run_id uuid references search_runs (id) on delete set null,
  add column if not exists raw_fingerprint text;

create index if not exists idx_identity_candidates_search_run
  on identity_candidates (search_run_id);
