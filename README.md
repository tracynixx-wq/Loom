# Loon Messenger

Loon is an iPhone-first PWA messenger prototype. Android packaging can be added after the web MVP is stable.

## Included now
- iPhone standalone PWA shell and dark purple UI;
- email registration and login via Supabase Auth;
- unique public usernames;
- direct one-to-one conversations;
- persistent PostgreSQL messages and live delivery via Supabase Realtime;
- Row Level Security policies for profiles, conversations and messages;
- GitHub Pages deployment workflow.

## One-time setup required
1. Create a free Supabase project.
2. Run the SQL in `supabase/schema.sql` using Supabase SQL Editor.
3. In Supabase Project Settings → API, copy the Project URL and the anon/publishable key.
4. In GitHub repository Settings → Secrets and variables → Actions → Variables, add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_ANON_KEY` = the anon/publishable key
5. In GitHub Settings → Pages, choose **GitHub Actions** as the build and deployment source.
6. In Supabase Authentication → URL Configuration, set Site URL to the deployed GitHub Pages URL and add it to Redirect URLs.
7. In Supabase Authentication settings, enable Email. Email confirmation can remain enabled; users will need to confirm their email before signing in.

After these steps, pushing to main deploys Loon automatically.

## iPhone installation
Open the deployed HTTPS address in Safari → Share → Add to Home Screen.

## Security
Only the Supabase anon/publishable key belongs in the browser. Never put a service_role or secret key into GitHub variables, config.js, or frontend code. Database access is restricted by RLS.

## MVP limitations
This is not production-scale yet. Group chats, media uploads, push notifications, end-to-end encryption, blocking/reporting, rate limits, account recovery UX and Android APK packaging remain future work.
