/** Read-only audit; creates no collections, indexes or migrations. */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';

const collections = ['sites', 'profiles', 'scans', 'pages', 'issues', 'scan_events', 'workers'];
async function main() {
  if (!process.env.MONGO_URI) throw Error('MONGO_URI is not configured');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGO_DATABASE || 'website_auditor');
    const report: {
      database: string;
      generatedAt: string;
      collections: Record<string, { count: number; idsSHA256: string }>;
      sampledRelations: { type: string; checked: number; missing: number }[];
    } = {
      database: db.databaseName,
      generatedAt: new Date().toISOString(),
      collections: {},
      sampledRelations: [],
    };
    for (const collectionName of collections) {
      const collection = db.collection(collectionName);
      const hash = createHash('sha256');
      let count = 0;
      for await (const record of collection
        .find({}, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .batchSize(1000)) {
        count++;
        hash.update(String(record._id));
        hash.update('\n');
      }
      report.collections[collectionName] = { count, idsSHA256: hash.digest('hex') };
    }
    for (const { from, field, to } of [
      { from: 'profiles', field: 'siteId', to: 'sites' },
      { from: 'scans', field: 'siteId', to: 'sites' },
      { from: 'pages', field: 'scanId', to: 'scans' },
      { from: 'issues', field: 'pageId', to: 'pages' },
    ]) {
      const samples = await db
        .collection(from)
        .find({}, { projection: { [field]: 1 } })
        .sort({ _id: -1 })
        .limit(100)
        .toArray();
      let missing = 0;
      for (const sample of samples) {
        const sourceId = sample[field];
        if (typeof sourceId !== 'string' || !ObjectId.isValid(sourceId)) {
          missing++;
          continue;
        }
        const found = await db
          .collection(to)
          .findOne({ _id: new ObjectId(sourceId) }, { projection: { _id: 1 } });
        if (!found) missing++;
      }
      report.sampledRelations.push({
        type: `${from}.${field} -> ${to}._id`,
        checked: samples.length,
        missing,
      });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error('Data integrity check failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
