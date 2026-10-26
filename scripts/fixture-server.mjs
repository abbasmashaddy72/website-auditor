// Isolated localhost fixture. No production application is accessed or modified.
import { createServer } from 'node:http';
const port = Number(process.env.FIXTURE_PORT || 8877);
const validSession = (req) => /(?:^|;\s*)auditor_fixture=ok(?:;|$)/.test(req.headers.cookie || '');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/livewire-84119ac4/update' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const input = new URLSearchParams(body);
    const authorized =
      input.get('email') === 'fixture@example.test' && input.get('password') === 'fixture-only-password';
    res.writeHead(authorized ? 200 : 422, {
      'Content-Type': 'application/json',
      ...(authorized ? { 'Set-Cookie': 'auditor_fixture=ok; Path=/; HttpOnly; SameSite=Lax' } : {}),
    });
    res.end(JSON.stringify({ ok: authorized }));
    return;
  }
  if (path === '/livewire-login') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(`<!doctype html><title>Livewire fixture</title>
      <form id="auth-form"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>
      <script>
        document.getElementById('auth-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const result = await fetch('/livewire-84119ac4/update', {
            method: 'POST',
            body: new URLSearchParams(new FormData(event.target)),
          });
          if (result.ok) location.assign('/private/dashboard');
          else document.body.insertAdjacentHTML('beforeend', '<p role="alert">Invalid credentials</p>');
        });
      </script>`);
    return;
  }
  if (path === '/login' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const inputs = new URLSearchParams(body);
    if (
      inputs.get('email') === 'fixture@example.test' &&
      inputs.get('password') === 'fixture-only-password'
    ) {
      res.writeHead(303, {
        Location: '/private/dashboard',
        'Set-Cookie': 'auditor_fixture=ok; Path=/; HttpOnly; SameSite=Lax',
      });
    } else res.writeHead(303, { Location: '/login?invalid=1' });
    res.end();
    return;
  }
  if (path === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(
      '<!doctype html><title>Fixture Login</title><form action="/login" method="post"><input name="email" type="email"><input name="password" type="password"><button type="submit">Sign in</button></form>',
    );
    return;
  }
  if (path.startsWith('/private/') && !validSession(req)) {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }
  const statuses = { '/ok': 200, '/forbidden': 403, '/missing': 404, '/broken': 500 };
  const code = statuses[path] ?? 200;
  const dynamicNav =
    path === '/private/dashboard'
      ? `<aside role="navigation"><button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('extra').hidden=false">Reports</button><div id="extra" hidden><a href="/private/report">Secret report</a><a href="/private/settings">Secret settings</a></div></aside>`
      : '';
  const jsError =
    path === '/runtime' ? '<script>throw new Error("Intentional fixture runtime failure")</script>' : '';
  res.writeHead(code, { 'Content-Type': 'text/html;charset=utf-8' });
  res.end(
    `<!doctype html><title>Fixture ${code}</title><body><nav><a href="/ok">OK</a> <a href="/forbidden">Forbidden</a> <a href="/missing">Missing</a> <a href="/broken">Error</a> <a href="/runtime">Runtime</a></nav>${dynamicNav}<main><h1>Fixture ${path}</h1>${jsError}</main></body>`,
  );
});
server.listen(port, '127.0.0.1', () => console.log(`Fixture server: http://127.0.0.1:${port}`));
