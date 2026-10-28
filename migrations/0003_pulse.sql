create table if not exists pulse (
  id int primary key,
  last_at bigint not null
);

insert into pulse (id, last_at) values (1, 0) on conflict (id) do nothing;
