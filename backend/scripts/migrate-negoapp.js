/**
 * NegoApp data migration: copies docs from the standalone `negoapp` database
 * into the main `usa_db` database under `nego_*` collection prefixes.
 *
 * Usage:
 *   node backend/scripts/migrate-negoapp.js [--dry-run]
 *
 * Safe to re-run: uses upsert by `id` (or `userId` for configs).
 * Original `negoapp` database is left untouched.
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SOURCE_URI = process.env.NEGOAPP_MONGO_URI || 'mongodb://127.0.0.1:27017/negoapp';
const TARGET_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/usa_db';
const DRY_RUN = process.argv.includes('--dry-run');

const COLLECTIONS = [
  { source: 'leads',    target: 'nego_leads',    key: 'id'     },
  { source: 'missions', target: 'nego_missions', key: 'id'     },
  { source: 'messages', target: 'nego_messages', key: 'id'     },
  { source: 'configs',  target: 'nego_configs',  key: 'userId' },
];

async function migrate() {
  console.log(`[migrate-negoapp] dry-run=${DRY_RUN}`);
  console.log(`[migrate-negoapp] source: ${SOURCE_URI}`);
  console.log(`[migrate-negoapp] target: ${TARGET_URI}`);

  const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
  const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();

  const summary = [];

  for (const { source, target, key } of COLLECTIONS) {
    const srcCol = sourceConn.db.collection(source);
    const tgtCol = targetConn.db.collection(target);

    const docs = await srcCol.find({}).toArray();
    if (docs.length === 0) {
      summary.push({ collection: target, copied: 0, skipped: 0, note: 'source empty' });
      continue;
    }

    let copied = 0;
    let skipped = 0;

    if (DRY_RUN) {
      summary.push({ collection: target, copied: 0, skipped: docs.length, note: 'dry-run, no writes' });
      continue;
    }

    for (const doc of docs) {
      const filter = { [key]: doc[key] };
      if (!doc[key]) { skipped++; continue; }
      const { _id, __v, ...rest } = doc;
      const result = await tgtCol.updateOne(filter, { $set: rest }, { upsert: true });
      if (result.upsertedCount > 0 || result.modifiedCount > 0) copied++;
      else skipped++;
    }

    summary.push({ collection: target, copied, skipped, note: `${docs.length} source docs` });
  }

  console.log('\n[migrate-negoapp] Results:');
  console.table(summary);

  await sourceConn.close();
  await targetConn.close();
}

migrate()
  .then(() => { console.log('[migrate-negoapp] Done.'); process.exit(0); })
  .catch(err => { console.error('[migrate-negoapp] Failed:', err); process.exit(1); });
