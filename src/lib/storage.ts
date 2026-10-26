import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
let client: S3Client | undefined;
function s3(): S3Client {
  if (!client)
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
  return client;
}
const bucket = () => process.env.S3_BUCKET || 'website-auditor-private';
export async function ensureBucket() {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e;
    await s3().send(new CreateBucketCommand({ Bucket: bucket() }));
  }
}
export async function putEvidence(key: string, data: string | Buffer, contentType: string): Promise<string> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: data,
      ContentType: contentType,
      ServerSideEncryption: undefined,
    }),
  );
  return key;
}
export async function getEvidence(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  if (!key.startsWith('websites/') || key.includes('..')) throw Error('Invalid evidence key');
  const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = result.Body;
  if (!body) throw Error('Evidence is empty');
  const bytes = Buffer.from(await body.transformToByteArray());
  return { bytes, contentType: result.ContentType || 'application/octet-stream' };
}

/** Delete a single scan's private evidence after an administrator has confirmed cleanup. */
export async function deleteScanEvidence(siteId: string, scanId: string): Promise<number> {
  if (!/^[a-f\d]{24}$/i.test(siteId) || !/^[a-f\d]{24}$/i.test(scanId))
    throw Error('Invalid evidence cleanup target');
  const prefix = `websites/${siteId}/scans/${scanId}/`;
  let deleted = 0;
  // Always relist from the beginning: deletions can invalidate continuation cursors.
  for (let round = 0; round < 10000; round++) {
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const batch = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1000 }),
    );
    const objects = (batch.Contents || [])
      .map((v) => v.Key)
      .filter((k): k is string => Boolean(k?.startsWith(prefix)));
    if (objects.length) {
      const result = await s3().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length)
        throw Error(`RustFS refused deletion of ${result.Errors.length} evidence object(s)`);
      deleted += objects.length;
    }
    if (!batch.IsTruncated && objects.length === 0) return deleted;
    if (objects.length === 0) throw Error('RustFS returned a truncated empty listing');
  }
  throw Error('RustFS cleanup exceeded its safety iteration limit');
}
