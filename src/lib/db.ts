import { MongoClient, type Db } from 'mongodb';
let connection: Promise<MongoClient> | undefined;
export async function database(): Promise<Db> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not configured');
  connection ??= new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 })
    .connect()
    .catch((e) => {
      connection = undefined;
      throw e;
    });
  return (await connection).db(process.env.MONGO_DATABASE || 'website_auditor');
}
export async function ensureIndexes(): Promise<void> {
  const db = await database();
  await Promise.all([
    db.collection('sites').createIndex({ baseUrl: 1 }, { unique: true }),
    db.collection('profiles').createIndex({ siteId: 1 }),
    db
      .collection('profiles')
      .createIndex(
        { siteId: 1, profileNameKey: 1 },
        { unique: true, partialFilterExpression: { profileNameKey: { $type: 'string' } } },
      ),
    db.collection('issues').createIndex({ status: 1, lastDetectedAt: -1 }),
    db.collection('scans').createIndex({ status: 1, leaseUntil: 1, createdAt: 1 }),
    db
      .collection('scans')
      .createIndex(
        { activeKey: 1 },
        { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
      ),
    db.collection('scan_events').createIndex({ scanId: 1, at: -1 }),
    db.collection('scan_events').createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 }),
    db.collection('workers').createIndex({ heartbeatAt: 1 }),
    db.collection('pages').createIndex({ scanId: 1, url: 1 }, { unique: true }),
    db.collection('pages').createIndex({ capturedAt: -1, _id: -1 }),
    db.collection('pages').createIndex({ siteId: 1, capturedAt: -1 }),
    db.collection('pages').createIndex({ siteId: 1, authProfileId: 1, classification: 1, capturedAt: -1 }),
    db.collection('pages').createIndex({ status: 1, capturedAt: -1 }),
    db.collection('issues').createIndex({ siteId: 1, authProfileId: 1, fingerprint: 1 }, { unique: true }),
  ]);
}
