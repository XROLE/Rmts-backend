-- Migration audit for production Supabase DB. Read-only. Paste in SQL editor.
-- Returns one row per local migration (001-028); "present" = true when the
-- object(s) that migration creates/expects exist in the DB.
SELECT '001' AS mig,
       CASE WHEN to_regclass('public.roommate_profiles') IS NOT NULL
             AND to_regtype('public.gender_enum') IS NOT NULL
             AND to_regtype('public.occupation_status_enum') IS NOT NULL
            THEN true ELSE false END AS present, 'create_profiles' AS name
UNION ALL SELECT '002',
       to_regclass('public.users') IS NOT NULL
       AND to_regclass('public.ambassador_profiles') IS NOT NULL
       AND to_regtype('public.user_role_enum') IS NOT NULL
       AND to_regprocedure('public.set_updated_at()') IS NOT NULL,
       'create_ambassador_rbac'
UNION ALL SELECT '003',
       EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
               JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='users'
                 AND p.polname='users_select_own')
       AND EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
               JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='ambassador_profiles'
                 AND p.polname='ambassador_profiles_select_own'),
       'add_ambassador_rls_policies'
UNION ALL SELECT '004',
       to_regtype('public.user_verification_enum') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='ambassador_profiles'
                     AND column_name='verification_status'),
       'add_ambassador_profile_fields'
UNION ALL SELECT '005',
       to_regclass('public.verification_codes') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='users'
                     AND column_name='email_verified'),
       'create_verification_codes'
UNION ALL SELECT '006',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='roommate_profiles'
                 AND column_name='state'),
       'add_state_to_roommate_profiles'
UNION ALL SELECT '007',
       to_regclass('public.support_tickets') IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
               JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='support_tickets'
                 AND p.polname LIKE 'Users%'),
       'create_support_tickets'
UNION ALL SELECT '008',
       to_regclass('public.payment_links') IS NOT NULL
       AND to_regclass('public.commission_earnings') IS NOT NULL
       AND to_regclass('public.withdrawals') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='ambassador_profiles'
                     AND column_name='available_balance_ngn'),
       'create_payment_tables'
UNION ALL SELECT '009',
       EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
               WHERE t.typname='profile_status_enum' AND e.enumlabel='matched')
       AND NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
               WHERE t.typname='profile_status_enum' AND e.enumlabel='reviewing'),
       'update_profile_status_enum'
UNION ALL SELECT '010',
       to_regclass('public.roommate_matches') IS NOT NULL
       AND to_regtype('public.match_status_enum') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='payment_links'
                     AND column_name='match_id'),
       'create_roommate_matches'
UNION ALL SELECT '011',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='ambassador_profiles'
                 AND column_name='paystack_recipient_code'),
       'add_ambassador_recipient_code'
UNION ALL SELECT '012',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='withdrawals'
                 AND column_name='rejection_reason'),
       'reject_withdrawals'
UNION ALL SELECT '013',
       EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
               WHERE t.typname='user_verification_enum' AND e.enumlabel='approved')
       AND NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
               WHERE t.typname='user_verification_enum' AND e.enumlabel='verified'),
       'rename_verified_to_approved'
UNION ALL SELECT '014',
       to_regclass('public.match_whatsapp_handovers') IS NOT NULL
       AND to_regclass('public.whatsapp_messages') IS NOT NULL,
       'whatsapp_handover'
UNION ALL SELECT '015',
       to_regclass('public.matches') IS NOT NULL
       AND to_regclass('public.transactions') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='users'
                     AND column_name='phone')
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='roommate_profiles'
                     AND column_name='social_handle'),
       'roommate_lifecycle'
UNION ALL SELECT '016/017',
       to_regclass('public.flow_sessions') IS NULL,
       'flow_sessions (016 created, 017 dropped)'
UNION ALL SELECT '018',
       to_regclass('public.sido_conversations') IS NOT NULL
       AND to_regclass('public.sido_messages') IS NOT NULL
       AND to_regclass('public.sido_human_handovers') IS NOT NULL,
       'sido_bot'
UNION ALL SELECT '019',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='roommate_profiles'
                 AND column_name='welcome_sent_at'),
       'profile_request_confirmation'
UNION ALL SELECT '020',
       to_regclass('public.match_participants') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='transactions'
                     AND column_name='participant_id'),
       'match_confirmation_flow'
UNION ALL SELECT '021',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='match_participants'
                 AND column_name='payment_link_created_at'),
       'match_payment_expiry'
UNION ALL SELECT '022',
       to_regprocedure('public.is_super_admin()') IS NOT NULL
       AND to_regclass('public.job_postings') IS NOT NULL
       AND to_regclass('public.job_applications') IS NOT NULL,
       'job_postings_and_applications'
UNION ALL SELECT '023',
       to_regtype('public.job_department_enum') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='job_postings'
                     AND column_name='requirements'),
       'job_posting_columns'
UNION ALL SELECT '024',
       NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='job_postings'
                     AND column_name='position')
       AND EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname='chk_job_postings_salary_range'
                     AND conrelid='public.job_postings'::regclass),
       'fix_job_posting_migration'
UNION ALL SELECT '025',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='job_applications'
                 AND column_name='user_id' AND is_nullable='YES'),
       'job_applications_user_id_nullable'
UNION ALL SELECT '026',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='job_applications'
                 AND column_name='status'
                 AND data_type='USER-DEFINED'
                 AND udt_name='job_application_status_enum'),
       'job_application_status_enum'
UNION ALL SELECT '027',
       to_regtype('public.job_type_enum') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='job_postings'
                     AND column_name='job_type'),
       'add_job_type'
UNION ALL SELECT '028',
       EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
               WHERE t.typname='verification_channel_enum'
                 AND e.enumlabel='password_reset'),
       'password_reset_channel'
ORDER BY mig;