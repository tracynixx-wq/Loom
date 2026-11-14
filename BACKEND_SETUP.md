# Loon backend setup

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run the complete file supabase/schema.sql.
3. In Project Settings → API, copy the Project URL and anon/publishable key.
4. Copy config.example.js to config.js and paste those two public values.
5. In Authentication → URL Configuration, set the Site URL to the HTTPS address where Loon is hosted and add that URL to Redirect URLs.
6. Enable Email auth. For early testing, email confirmation may be disabled in Auth settings; otherwise users must confirm their email before signing in.

## Included backend foundation

- email registration and sign-in;
- unique public usernames;
- direct one-to-one chats;
- messages stored in Postgres and delivered live through Supabase Realtime;
- row-level security for profiles, conversations, memberships and messages.

## Security and limitations

- config.js is intentionally ignored by Git.
- Never use a Supabase service_role key in the browser or commit it.
- This is an MVP foundation, not a production Telegram-scale system.
- Media, group chats, push notifications, end-to-end encryption, abuse reporting and account recovery UX are not included yet.
