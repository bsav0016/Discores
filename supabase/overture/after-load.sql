-- Run after loading Overture files, to see what you got.

-- Courses per state and source.
select split_part(area, ', ', 2) as state, source, count(*) as courses
from public.courses
where area like '%, __'
group by 1, 2
order by 3 desc;

-- Totals.
select source, count(*) from public.courses group by source order by source;

-- Entries whose name doesn't say "disc golf", "DGC" or "frisbee": the most likely non-courses to review by hand.
select name, area from public.courses
where source = 'overture'
  and name !~* '(disc ?golf|dgc|dgp|frisbee|disk golf)'
order by area, name;

-- Same name in the same state (possible duplicates the 400 m / 5 km rules missed).
select name, area, count(*) from public.courses
where source in ('osm', 'overture')
group by name, area
having count(*) > 1;
