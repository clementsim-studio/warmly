-- Widen cards.occasion from ('birthday','farewell') to the five occasions
-- the Create screen now offers: birthday, farewell, thanks, graduation, other.
-- Run this once in the Supabase SQL Editor for this project.

alter table cards drop constraint if exists cards_occasion_check;
alter table cards add constraint cards_occasion_check
  check (occasion in ('birthday', 'farewell', 'thanks', 'graduation', 'other'));
