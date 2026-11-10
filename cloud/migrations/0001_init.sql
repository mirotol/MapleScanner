-- The shared price database: raw listings read off players' screens, never calculated prices.
-- Times are milliseconds since 1970, as in the app.

-- One row per real item (names from osms-items.json, under its spelling). The counters are kept
-- by the triggers below, so the Prices list doesn't count every listing on each request.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  added INTEGER NOT NULL,
  listings INTEGER NOT NULL DEFAULT 0,
  sold_listings INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER
);

-- One row per distinct listing: the same seller, amount, price and sold state is one listing,
-- however many times or by however many players it was seen. `updated` is the server time of
-- its last change, which is what the app syncs by.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so a removal can't hide a newer listing
  item_id INTEGER NOT NULL REFERENCES items(id),
  seller TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  sold INTEGER NOT NULL,
  copies INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  channel INTEGER,
  map TEXT,
  room INTEGER,
  shop TEXT,
  stats TEXT,
  updated INTEGER NOT NULL,
  UNIQUE (item_id, seller, qty, price, sold)
);
CREATE INDEX listings_updated ON listings (updated, id);
CREATE INDEX listings_item ON listings (item_id, last_seen);
CREATE INDEX listings_recent ON listings (last_seen);

-- Each install that uploads. Only a hash of its key is kept, never an IP address.
CREATE TABLE uploaders (
  id INTEGER PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_upload INTEGER,
  rows INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0
);

-- Which installs saw each listing, and when. Lets the admin remove one install's data, and lets
-- prices count installs as well as sellers.
CREATE TABLE reports (
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  uploader_id INTEGER NOT NULL REFERENCES uploaders(id),
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (listing_id, uploader_id)
);
CREATE INDEX reports_uploader ON reports (uploader_id);

-- Listings the admin removed, so apps drop them on their next sync.
CREATE TABLE removed (
  listing_id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX removed_at ON removed (at);

CREATE TRIGGER listing_added AFTER INSERT ON listings BEGIN
  UPDATE items SET listings = listings + 1, sold_listings = sold_listings + NEW.sold,
    last_seen = MAX(COALESCE(last_seen, 0), NEW.last_seen) WHERE id = NEW.item_id;
END;

CREATE TRIGGER listing_seen AFTER UPDATE OF last_seen ON listings BEGIN
  UPDATE items SET last_seen = MAX(COALESCE(last_seen, 0), NEW.last_seen) WHERE id = NEW.item_id;
END;

CREATE TRIGGER listing_removed AFTER DELETE ON listings BEGIN
  UPDATE items SET listings = listings - 1, sold_listings = sold_listings - OLD.sold,
    last_seen = (SELECT MAX(last_seen) FROM listings WHERE item_id = OLD.item_id) WHERE id = OLD.item_id;
END;
