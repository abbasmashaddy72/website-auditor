/** Download a completed private response in a browser. Do not revoke the object URL
 * during the same event turn: Firefox may not yet have started reading it.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw Error('File downloads require an active browser session');
  if (!blob.size) throw Error('The server returned an empty file');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName || 'website-auditor-export';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
