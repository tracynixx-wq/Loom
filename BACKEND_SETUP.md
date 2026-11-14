# Loon — backend and deployment setup

## 1. Create Supabase backend
1. Create a free project at https://supabase.com.
2. Open SQL Editor and run the complete file supabase/schema.sql.
3. Open Project Settings → API. Copy Project URL and anon/publishable key.

## 2. Add public project settings to GitHub Actions
In this repository open Settings → Secrets and variables → Actions → Variables and add:
- SUPABASE_URL — Supabase Project URL
- SUPABASE_ANON_KEY — Supabase anon/publishable key

These are browser-public values protected by database Row Level Security. Never add service_role or secret keys.

## 3. Enable deployment
In repository Settings → Pages choose GitHub Actions as the source. The workflow in .github/workflows/deploy.yml deploys the site after pushes to main.

## 4. Configure Supabase Auth URLs
After the first deployment, copy the GitHub Pages URL. In Supabase Authentication → URL Configuration:
- set Site URL to the deployed site URL;
- add the same URL to Redirect URLs.

Keep email confirmation enabled unless you deliberately want faster throwaway testing.

## Included backend
- email registration/sign-in;
- username profiles;
- direct one-to-one chats;
- PostgreSQL message storage;
- realtime message delivery;
- row-level security and membership checks.

## Still not included
Group chats, attachments, voice/video calls, push notifications, end-to-end encryption, blocking/reporting, spam controls and production-scale operations.
