ALTER TABLE accounts ADD COLUMN browser_profile_ref varchar(100),
 ADD COLUMN identity_binding_version integer NOT NULL DEFAULT 1 CHECK(identity_binding_version>0),
 ADD COLUMN confirmed_verification_id uuid, ADD COLUMN confirmed_at timestamptz,
 ADD COLUMN verification_next_at timestamptz;
ALTER TABLE accounts ADD CHECK(browser_profile_ref IS NULL OR browser_profile_ref ~ '^[A-Za-z0-9_-]{1,100}$');
CREATE TABLE account_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 binding_version integer NOT NULL CHECK(binding_version>0),expected_platform_user_id varchar(24) NOT NULL CHECK(expected_platform_user_id ~ '^[a-f0-9]{24}$'),
 browser_profile_ref varchar(100) NOT NULL CHECK(browser_profile_ref ~ '^[A-Za-z0-9_-]{1,100}$'),
 requested_by uuid NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),job_id uuid NOT NULL,
 result jsonb,applied_at timestamptz,
 UNIQUE(workspace_id,account_id,id),UNIQUE(job_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,requested_by) REFERENCES memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
 CHECK((result IS NULL)=(applied_at IS NULL)),CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
CREATE INDEX account_verification_history ON account_verifications(workspace_id,account_id,requested_at DESC,id DESC);
CREATE INDEX account_verification_success ON account_verifications(workspace_id,account_id,requested_at DESC,id DESC) WHERE result->>'public_status'='matched';
ALTER TABLE accounts ADD FOREIGN KEY(workspace_id,id,confirmed_verification_id) REFERENCES account_verifications(workspace_id,account_id,id);
CREATE FUNCTION account_verification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.result IS NOT NULL THEN RAISE EXCEPTION 'Account verification evidence is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.workspace_id,NEW.account_id,NEW.binding_version,NEW.expected_platform_user_id,NEW.browser_profile_ref,NEW.requested_by,NEW.requested_at,NEW.job_id)
 IS DISTINCT FROM (OLD.workspace_id,OLD.account_id,OLD.binding_version,OLD.expected_platform_user_id,OLD.browser_profile_ref,OLD.requested_by,OLD.requested_at,OLD.job_id)
 THEN RAISE EXCEPTION 'Account verification input is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_verification_immutable BEFORE UPDATE OR DELETE ON account_verifications FOR EACH ROW EXECUTE FUNCTION account_verification_immutable();
-- Preserve the existing scope predicate, including all retired workflows.
ALTER FUNCTION yoyo_job_supported(text,text,jsonb) RENAME TO yoyo_job_supported_pre_account;
CREATE FUNCTION yoyo_job_supported(job_type text,job_pool text,job_input jsonb) RETURNS boolean LANGUAGE sql AS $$
 SELECT public.yoyo_job_supported_pre_account(job_type,job_pool,job_input)
 AND (job_type<>'account.verify' OR (job_pool='general' AND COALESCE(job_input->>'verification_id','') ~ '^[a-f0-9-]{36}$'))
$$;
