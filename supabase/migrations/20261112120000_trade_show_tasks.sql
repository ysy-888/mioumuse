-- Trade shows can carry their own tasks (Email, Graphic, Social Media), as
-- campaigns do, on top of the emails worked out from Day 1. Same shape as
-- campaigns.tasks: [{ id, category, dueDate }]. Safe to re-run.

alter table trade_shows add column if not exists tasks jsonb not null default '[]';
