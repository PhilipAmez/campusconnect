create table if not exists public.quizzes (
    id uuid primary key default gen_random_uuid(),

    title text not null default '',
    description text default '',
    instructions text default '',

    quiz_type text not null default 'mixed'
        check (quiz_type in ('mcq','essay','mixed')),

    time_limit integer default 30,

    open_date timestamptz,
    close_date timestamptz,

    attempts_allowed integer default 1,

    visibility text default 'institution'
        check (visibility in ('private','group','institution','public')),

    creator_id uuid
        default auth.uid()
        references public.profiles(id)
        on delete set null,

    institution text,

    status text default 'draft'
        check (status in ('draft','published','closed','archived')),

    published_at timestamptz,
    closed_at timestamptz,

    created_at timestamptz default now(),
    updated_at timestamptz default now(),

    is_deleted boolean default false
);

create table if not exists public.quiz_questions (
    id uuid primary key default gen_random_uuid(),

    quiz_id uuid not null
        references public.quizzes(id)
        on delete cascade,

    question_order integer not null,

    question_type text not null default 'mcq'
        check (
            question_type in (
                'mcq',
                'true_false',
                'short_answer',
                'essay'
            )
        ),

    prompt text not null default '',

    points integer default 10,

    required boolean default false,

    explanation text default '',

    character_limit integer,

    options jsonb default '[]'::jsonb,

    correct_option integer default 0,

    shuffle_options boolean default false,

    created_at timestamptz default now(),

    unique(quiz_id, question_order)
);

create table if not exists public.quiz_groups (
    id uuid primary key default gen_random_uuid(),

    quiz_id uuid not null
        references public.quizzes(id)
        on delete cascade,

    group_id uuid not null
        references public.groups(id)
        on delete cascade,

    created_at timestamptz default now(),

    unique(quiz_id, group_id)
);

alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_groups enable row level security;

create policy if not exists quizzes_select_lecturers on quizzes
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quizzes_insert_lecturers on quizzes
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quizzes_update_lecturers on quizzes
  for update using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_questions_select_lecturers on quiz_questions
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_questions_insert_lecturers on quiz_questions
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_questions_update_lecturers on quiz_questions
  for update using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_groups_select_lecturers on quiz_groups
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_groups_insert_lecturers on quiz_groups
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );

create policy if not exists quiz_groups_update_lecturers on quiz_groups
  for update using (
    auth.uid() is not null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and (p.is_lecturer = true or p.role = 'lecturer' or p.level = 'lecturer' or p.custom_level = 'lecturer')
    )
  );
