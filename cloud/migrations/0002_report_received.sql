-- When the server first got each install's report of a listing (Nov 13). The app says when it saw
-- something, which can be made up, so who reported a listing first goes by this (trust.js): a copy
-- of a listing from the public sync always arrives after the report it was copied from. Reports
-- from before this have none, and fall back to the app's time.
ALTER TABLE reports ADD COLUMN received INTEGER;
