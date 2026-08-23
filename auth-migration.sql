-- Run this in Supabase SQL Editor before enabling signed-in conversations.
-- Existing conversations are assigned to Matt's account after sign-in.

alter table public.conversations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Replace this with Matt's Supabase auth user id after his first Google sign-in.
-- update public.conversations
-- set user_id = 'YOUR-SUPABASE-USER-UUID'
-- where user_id is null;

create index if not exists conversations_user_id_idx
  on public.conversations(user_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Users can view their conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "Users can create their conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update their conversations"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "Users can delete their conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

create policy "Users can view messages in their conversations"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

create policy "Users can create messages in their conversations"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

create policy "Users can delete messages in their conversations"
  on public.messages for delete
  using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );
