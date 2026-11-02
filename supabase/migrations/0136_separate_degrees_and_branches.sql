-- 0136_separate_degrees_and_branches.sql
-- Separates combined degree names into canonical degrees and branches.
-- Normalises degree credentials (B.E., B.Tech, B.Sc, BCA, MCA, M.Sc) and maps
-- disciplines to branches table.

-- 1. Ensure clean canonical degrees exist
insert into degrees (name) values
  ('B.Sc'),
  ('B.E.'),
  ('B.Tech'),
  ('M.Sc'),
  ('BCA'),
  ('MCA')
on conflict (name) do nothing;

-- 2. Ensure canonical branches exist under degrees
insert into branches (degree_id, name)
select d.id, b.name
from degrees d
cross join (
  values
    ('B.Sc', 'Artificial Intelligence and Machine Learning'),
    ('B.Sc', 'Computer Science with Artificial Intelligence'),
    ('B.Sc', 'Artificial Intelligence'),
    ('B.Sc', 'Computer Technology'),
    ('B.E.', 'Computer Science and Engineering'),
    ('B.E.', 'Information Technology'),
    ('B.E.', 'Electronics and Communication Engineering'),
    ('B.E.', 'Mechanical Engineering'),
    ('B.E.', 'Civil Engineering'),
    ('B.E.', 'Electrical and Electronics Engineering'),
    ('B.Tech', 'Artificial Intelligence and Data Science'),
    ('B.Tech', 'Information Technology'),
    ('B.Tech', 'Computer Science and Business Systems'),
    ('M.Sc', 'Computer Science')
) as b(degree_name, name)
where d.name = b.degree_name
on conflict (degree_id, name) do nothing;

