export function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[a-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:authorization|cookie|set-cookie|api[_-]?key|secret|token|password)\s*[:=]\s*)[^\s;,\"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/(value=[\"'])[\w+/=-]{24,}([\"'])/gi, '$1[REDACTED]$2');
}
export function redactHtml(html: string): string {
  return redactText(html)
    .replace(
      /(<input\b[^>]*\btype\s*=\s*["']?(?:password|hidden)["']?[^>]*\bvalue\s*=\s*)["'][^"']*["']/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /(<meta\b[^>]*\bname\s*=\s*["'](?:csrf-token|api-key)["'][^>]*\bcontent\s*=\s*)["'][^"']*["']/gi,
      '$1"[REDACTED]"',
    )
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1/* script removed from stored snapshot */$2');
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // URLs embedded in third-party resources may contain Basic Auth credentials.
    // Never surface those values in exported diagnostics or worker logs.
    if (u.username) u.username = 'REDACTED';
    if (u.password) u.password = 'REDACTED';
    if (/(?:token|password|secret|key|auth|session|jwt|signature|code|csrf|credential)[=:]/i.test(u.hash))
      u.hash = '#[REDACTED]';
    for (const key of u.searchParams.keys())
      if (/(?:token|password|secret|key|auth|session|jwt|signature|code|csrf|credential)/i.test(key))
        u.searchParams.set(key, '[REDACTED]');
    return u.toString();
  } catch {
    return redactText(raw);
  }
}
