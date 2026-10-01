-- Trend Radar report archive. Run once in the Supabase SQL editor (Database → SQL).
-- Every research is saved here when it completes: one row per report, plus the flattened results and signals
-- so the archive can be queried across keywords, platforms and dates. The full report JSON lives in reports.data.

create table if not exists public.reports (
  id            text primary key,
  topic         text not null,
  brief         text not null default '',
  mode          text not null default 'topic',
  region        text,
  window_h      integer,
  platforms     text[] not null default '{}',
  status        text not null default 'running',
  created_at    timestamptz not null,
  completed_at  timestamptz,
  duration_s    integer,
  n_items       integer not null default 0,   -- results kept (on-topic)
  n_offtopic    integer not null default 0,   -- results the AI marked off-topic / outside the focus
  n_signals     integer not null default 0,
  top_signal    text,
  summary       text,
  next_queries  text[] not null default '{}',
  brain_model   text,
  key_source    text,
  visitor       text,                          -- hashed IP of whoever started it (no personal data)
  data          jsonb not null,                -- the complete report as shown in the dashboard
  saved_at      timestamptz not null default now()
);
create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_topic_idx   on public.reports (lower(topic));
create index if not exists reports_status_idx  on public.reports (status);

create table if not exists public.report_items (
  report_id    text not null references public.reports(id) on delete cascade,
  item_id      text not null,
  platform     text not null,
  title        text not null,
  url          text,
  metric       numeric,
  metric_label text,
  age_h        numeric,
  published    timestamptz,
  category     text,
  safety       text,
  score        integer,
  momentum     integer,
  offtopic     boolean not null default false,
  cluster_id   text,
  extra        text,
  primary key (report_id, item_id)
);
create index if not exists report_items_platform_idx on public.report_items (platform);
create index if not exists report_items_report_idx   on public.report_items (report_id);

create table if not exists public.report_signals (
  report_id  text not null references public.reports(id) on delete cascade,
  signal_id  text not null,
  name       text not null,
  category   text,
  safety     text,
  score      integer,
  momentum   integer,
  platforms  text[] not null default '{}',
  n_items    integer not null default 0,
  why        text,
  angles     text[] not null default '{}',
  formats    text[] not null default '{}',
  primary key (report_id, signal_id)
);
create index if not exists report_signals_report_idx on public.report_signals (report_id);

-- Lock the tables down: only the server (secret key) can read or write; the public anon key sees nothing.
alter table public.reports        enable row level security;
alter table public.report_items   enable row level security;
alter table public.report_signals enable row level security;
