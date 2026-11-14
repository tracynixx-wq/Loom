# Loon Messenger

Loon is an iPhone-first PWA messenger prototype. Android packaging can be added after the web MVP is stable.

## Included now
- iPhone standalone PWA shell and dark purple UI;
- email registration and login via Supabase Auth;
- unique public usernames;
- direct one-to-one conversations;
- persistent PostgreSQL messages and live delivery via Supabase Realtime;
- client-side end-to-end encryption for direct messages using Web Crypto (P-256 ECDH, HKDF-SHA-256, AES-256-GCM);
- Row Level Security policies for profiles, conversations and messages;
- GitHub Pages deployment workflow.

## Current backend
- Supabase project is connected through the public browser configuration in `config.js`.
- The publishable key is intended for browser use; never add a service_role or secret key to the repository.
- Database schema and RLS policies are documented in `supabase/schema.sql`.
- GitHub Actions publishes the static PWA from the repository root.

## Deployment and authentication
1. In GitHub Settings → Pages, choose **GitHub Actions** as the deployment source.
2. In Supabase Authentication → URL Configuration, set Site URL to the deployed GitHub Pages URL and add that URL to Redirect URLs.
3. Keep Email authentication enabled. If email confirmation is enabled, new users must confirm their address before signing in.

After Pages is enabled, pushing to main deploys Loon automatically.

## iPhone installation
Open the deployed HTTPS address in Safari → Share → Add to Home Screen.

## Security
Only the Supabase anon/publishable key belongs in the browser. Never put a service_role or secret key into GitHub variables, config.js, or frontend code. Database access is restricted by RLS.

## MVP limitations
This is not production-scale yet. Group chats, media uploads, push notifications, end-to-end encryption, blocking/reporting, rate limits, account recovery UX and Android APK packaging remain future work.
