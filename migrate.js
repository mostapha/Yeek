// migration.js - Run this once, then delete it
import Database from 'better-sqlite3';
const db = new Database('./registrations.sqlite3');

try {
  // Check if raw_input column exists
  const columns = db.prepare('PRAGMA table_info(comps)').all();
  const hasRawInputColumn = columns.some(col => col.name === 'raw_input');

  if (!hasRawInputColumn) {
    console.log('Running migration: adding raw_input column...');
    db.exec(`ALTER TABLE comps ADD COLUMN raw_input TEXT;`);
    console.log('✅ Migration complete');
  } else {
    console.log('ℹ️  raw_input column already exists');
  }

  // Clear all comps
  console.log('Clearing comps table...');
  const result = db.prepare('DELETE FROM comps').run();
  console.log(`✅ Cleared ${result.changes} comp(s) from table`);

} catch (err) {
  console.error('❌ Migration failed:', err);
}

db.close();
console.log('Migration script finished. You can delete this file now.');