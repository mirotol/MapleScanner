// A small stand-in for Cloudflare D1 over Node's built-in SQLite, so the Worker's SQL can be tested
// with `npm test`. Only for tests: the app itself keeps no listing data.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params.map(p => (p === undefined ? null : p))); }
  runNow() { return this.db.prepare(this.sql).run(...this.params); }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    return column && row ? row[column] : row;
  }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params), success: true }; }
  async run() { const info = this.runNow(); return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }; }
}

// An in-memory database with the Worker's migrations applied.
function d1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'cloud', 'migrations');
  for (const file of fs.readdirSync(dir).sort()) db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    // D1 runs a batch as one transaction: all or nothing.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map(s => s.runNow());
        db.exec('COMMIT');
        return out.map(info => ({ success: true, meta: { changes: info.changes } }));
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

module.exports = { d1 };
