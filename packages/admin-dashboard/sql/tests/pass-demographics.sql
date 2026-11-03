-- Run with psql -f against an EMPTY, disposable PostgreSQL database.
-- This fixture creates minimal source tables; never run against a deployed database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE hub_user_passes(user_id uuid PRIMARY KEY, email text, created_at timestamptz);
CREATE TABLE hub_user_profiles(user_id uuid PRIMARY KEY, country_code text, country text, city text);
CREATE TABLE hub_user_wallets(user_id uuid, ecosystem text, address text, UNIQUE(user_id, ecosystem));
CREATE TABLE users(user_address text PRIMARY KEY, email text, country text, interests text[], created_at timestamptz DEFAULT now());
-- Country normalization fixture copied from migration 076.
CREATE OR REPLACE FUNCTION public.normalize_funded_voucher_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_country, '')))
    WHEN 'kenya' THEN 'KE'
    WHEN 'uganda' THEN 'UG'
    WHEN 'tanzania' THEN 'TZ'
    WHEN 'nigeria' THEN 'NG'
    WHEN 'ghana' THEN 'GH'
    WHEN 'rwanda' THEN 'RW'
    WHEN 'south africa' THEN 'ZA'
    WHEN 'zambia' THEN 'ZM'
    WHEN 'ethiopia' THEN 'ET'
    ELSE CASE
      WHEN btrim(COALESCE(p_country, '')) ~* '^[a-z]{2}$'
        THEN upper(btrim(p_country))
      ELSE NULL
    END
  END;
$$;

\ir ../../../../supabase/migrations/118_admin_pass_demographics.sql
INSERT INTO hub_user_passes VALUES
('00000000-0000-0000-0000-000000000001','linked@test','2026-11-02 21:00Z'),
('00000000-0000-0000-0000-000000000002','unique@test','2026-11-03 20:59:59Z'),
('00000000-0000-0000-0000-000000000003','ambiguous@test','2026-11-03 21:00Z'),
('00000000-0000-0000-0000-000000000004','missing@test','2026-11-02 20:59:59Z');
INSERT INTO hub_user_profiles VALUES
('00000000-0000-0000-0000-000000000001','KE','Kenya',' Nairobi '),
('00000000-0000-0000-0000-000000000002',null,null,'nairobi');
INSERT INTO hub_user_wallets VALUES
('00000000-0000-0000-0000-000000000001','minipay','0xSELECTED'),
('00000000-0000-0000-0000-000000000001','base','0xOTHER');
INSERT INTO users(user_address,email,country,interests) VALUES
('0xselected','linked@test','Uganda',ARRAY[' Travel ','travel','Food','',null]),
('0xother','linked@test','Ghana',ARRAY['Sports']),
('0xunique','unique@test','Kenya',ARRAY['TRAVEL']),
('0xambiguous1','ambiguous@test','Kenya',ARRAY['Music']),
('0xambiguous2','ambiguous@test','Kenya',ARRAY['Music']);
DO $$
DECLARE result jsonb;
BEGIN
 result := get_admin_pass_demographics('2026-11-03','2026-11-03');
 ASSERT result #>> '{selected,total}' = '2', 'Nairobi inclusive/exclusive dates';
 ASSERT result #>> '{all_time,total}' = '4', 'All Pass holders, including missing profiles';
 ASSERT result #>> '{selected,countries,known}' = '2', 'Hub country and legacy fallback';
 ASSERT result #> '{selected,countries,rows}' = '[{"label":"KE","users":2}]'::jsonb, 'Hub country overrides legacy; countries normalize';
 ASSERT result #> '{selected,cities,rows}' = '[{"label":"nairobi · KE","users":2}]'::jsonb, 'Cities normalize case and whitespace';
 ASSERT result #> '{selected,interests,rows}' = '[{"label":"travel","users":2},{"label":"food","users":1}]'::jsonb, 'Selected wallet, interest deduplication and sorting';
 ASSERT result #>> '{all_time,interests,known}' = '2', 'Ambiguous legacy identity must not inflate coverage';
 ASSERT NOT has_function_privilege('anon','get_admin_pass_demographics(date,date)','execute'), 'Anonymous denied';
 ASSERT NOT has_function_privilege('authenticated','get_admin_pass_demographics(date,date)','execute'), 'Consumer denied';
 ASSERT has_function_privilege('service_role','get_admin_pass_demographics(date,date)','execute'), 'Service role allowed';
 result := get_admin_pass_demographics('2020-01-01','2020-01-01');
 ASSERT result #>> '{selected,total}' = '0', 'Empty selected cohort';
 ASSERT result #> '{selected,countries,rows}' = '[]'::jsonb, 'Empty breakdown';
END $$;
TRUNCATE hub_user_passes;
DO $$ BEGIN
 ASSERT get_admin_pass_demographics('2026-11-03','2026-11-03') #>> '{all_time,total}' = '0', 'Empty all-time cohort';
END $$;

ROLLBACK;
