'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight, Activity } from 'lucide-react';
export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c1422] p-6 text-white">
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center gap-3">
          <span className="rounded-xl bg-[#4664df] p-3">
            <Activity size={25} />
          </span>
          <div>
            <div className="text-xl font-bold">Website Auditor</div>
            <div className="text-xs text-slate-400">Independent diagnostics platform</div>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-[#304259] bg-[#172235] p-8 shadow-2xl">
          <ShieldCheck size={28} className="text-[#92a8fa]" />
          <h1 className="mt-4 mb-2 text-2xl font-bold">Administrator sign in</h1>
          <p className="mb-8 text-sm text-slate-400">Access is restricted to authorized administrators.</p>
          <label htmlFor="password" className="mb-2 block text-sm">
            Administrator password
          </label>
          <input
            id="password"
            autoFocus
            required
            type="password"
            className="w-full rounded-lg border border-[#40506c] bg-[#101b2b] p-3 outline-none focus:border-[#809cff]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#496de9] py-3 font-semibold"
          >
            {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} />
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">
          Credentials and evidence remain on your configured infrastructure.
        </p>
      </div>
    </main>
  );
}
