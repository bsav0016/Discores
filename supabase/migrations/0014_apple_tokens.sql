-- Apple requires apps that offer Sign in with Apple to revoke the person's Apple token when they delete their
-- account. The refresh token Apple gives us is kept here, readable only by the Edge Functions (service role):
-- RLS is on with no policies and clients have no table privileges. It is deleted with the account.
create table public.apple_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now()
);
alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
