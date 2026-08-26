-- Atlas Identity Intelligence - subject enrollment workflow support
-- Layered on 0001..0004.
--
-- The analyst enrollment flow records PROVIDER OUTPUT as identity
-- candidates through the application API. Migration 0003 opened the UPDATE
-- path for candidate decisions but left identity_candidates without any
-- INSERT policy, so a client recording new provider candidates under row
-- level security would silently match zero rows. This policy opens the
-- minimum viable write path: analysts of the subject's organization may
-- record candidates. Authorization gating stays layered elsewhere:
--
--   - the application service refuses to contact matching providers for
--     any subject whose authorization_state is not 'authorized'
--   - gate_candidate_decisions (0002) blocks confirm/reject decisions
--     unless the parent subject is authorized
--   - trg_audit_candidate_recorded (0004) writes a sensitive audit event
--     for every recorded candidate

create policy "analysts record identity candidates"
  on identity_candidates for insert
  with check (
    can_write((
      select i.organization_id
      from subjects s
      join investigations i on i.id = s.investigation_id
      where s.id = subject_id
    ))
  );
