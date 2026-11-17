# Weekly growth report

Every Monday the **Growth report** workflow asks the database for a few counts and posts them as a comment on a GitHub issue called "Weekly growth report" (assigned to the repository owner, so GitHub emails it). It tells you whether anything you do to promote the app is working.

It is not analytics. The app still has none, and the privacy policy still says so. The report is aggregate counts the database can already work out (new accounts, rounds, friends, courses, app errors). Nothing in it names or identifies a person, no row is returned, and guest rounds (which stay on the phone) are not counted.

## One-time setup

1. **Make a key.** Any long random string, for example in PowerShell:
   `-join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })`
2. **Store its hash in the database.** In the Supabase SQL editor of the production project, with your key in place of `PASTE-THE-KEY-HERE`:
   ```sql
   insert into public.growth_report_key (hash)
   values (encode(sha256(convert_to('PASTE-THE-KEY-HERE', 'utf8')), 'hex'));
   ```
   Only the hash is stored. To change the key later, delete the row and insert a new one.
3. **Give GitHub the key.** Repository Settings, Secrets and variables, Actions, New repository secret, named `GROWTH_REPORT_KEY`, with the same key.
4. **Run it once.** Actions tab, "Growth report", Run workflow. The first run opens the issue. After that it comments every Monday at 14:23 UTC.

Until step 3 is done the workflow just prints a notice and finishes.

## What it reports

New accounts, rounds started, rounds with two or more registered players, players who played, and app errors, each against the week before. Totals: accounts, friendships, phones with notifications on, courses and how many have confirmed pars.

## If it stops working

- **"not allowed"** in the run log: the key in the secret does not match the stored hash. Repeat steps 1 to 3.
- **"function not found"**: migration 0030 is not applied in production.
- To switch it off, delete the `GROWTH_REPORT_KEY` secret (the workflow then does nothing) or delete the row in `growth_report_key` (the function then refuses everyone).
