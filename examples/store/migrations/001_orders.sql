create table if not exists store_orders (
  id uuid primary key,
  amount_base_units numeric not null check (amount_base_units = 25000000),
  cancel_token_hash text not null,
  checkout_reference text unique,
  checkout_url text,
  payment_id text unique,
  state text not null default 'pending' check (state in ('pending','fulfilled','cancelled','review')),
  state_version integer not null default 1 check (state_version > 0),
  payment_version integer not null default 0 check (payment_version >= 0),
  fulfillment_count integer not null default 0 check (fulfillment_count between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists store_receipts (
  event_id text primary key,
  order_id uuid not null references store_orders(id),
  payment_id text not null,
  payment_version integer not null,
  event_type text not null,
  disposition text not null,
  received_at timestamptz not null default now()
);
create index if not exists store_receipts_order_idx on store_receipts(order_id, received_at);
create table if not exists store_review_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references store_orders(id),
  event_id text,
  code text not null,
  created_at timestamptz not null default now(),
  unique(order_id,event_id,code)
);
