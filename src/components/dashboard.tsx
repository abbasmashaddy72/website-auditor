'use client';
import ReportExplorer from './report-explorer';
import DatabaseCleanup from './database-cleanup';
import EvidenceViewer from './evidence-viewer';
import type { PageTiming } from '../lib/performance';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
import {
  Activity,
  Globe2,
  ScanSearch,
  Route as RouteIcon,
  AlertTriangle,
  FileBarChart2,
  Settings,
  Plus,
  Sun,
  Moon,
  LogOut,
  RefreshCw,
  Play,
  Pause,
  Square,
  Eye,
  Copy,
  Download,
  Search,
  ShieldCheck,
  HardDrive,
  ExternalLink,
  ChevronRight,
  X,
  Menu,
  Clock4,
  Filter,
  Radio,
  Terminal,
  LoaderCircle,
  AlertCircle,
  Layers3,
} from 'lucide-react';

type Site = {
  _id: string;
  name: string;
  baseUrl: string;
  environment: string;
  sourcePath?: string;
  allowedHosts: string[];
  allowedPorts: number[];
  allowLocalhost: boolean;
  allowPrivateNetwork: boolean;
  ignoreHTTPSErrors: boolean;
  captureTraces?: boolean;
  captureHealthy?: boolean;
  allowPassiveLivewire?: boolean;
  allowLivewireBackground?: boolean;
  scheduleMinutes?: number;
  maxPages: number;
  discoveryMode?: 'navigation' | 'all-links';
  maxDepth: number;
  concurrency: number;
  timeoutMs: number;
  createdAt: string;
};
type Scan = {
  _id: string;
  siteId: string;
  authProfileId?: string;
  authProfileName?: string;
  authenticatedLandingUrl?: string;
  status: string;
  phase?: string;
  error?: string;
  lastActivityAt?: string;
  createdAt: string;
  startedAt?: string;
  reportKeys?: Record<string, string>;
  progress: {
    discovered: number;
    visited: number;
    passed: number;
    failed: number;
    warnings: number;
    currentUrl?: string;
  };
};
type Issue = {
  _id: string;
  siteId: string;
  authProfileId?: string;
  url: string;
  category: string;
  message: string;
  status: string;
  latestHttpStatus?: number;
  lastDetectedAt: string;
  pageId: string;
  scanId: string;
  occurrences: number;
};
type Page = {
  _id: string;
  siteId: string;
  authProfileId?: string;
  scanId: string;
  url: string;
  finalUrl: string;
  title: string;
  status?: number;
  classification: string;
  durationMs: number;
  performance?: PageTiming;
  issues: Array<{ category: string; message: string }>;
  warnings?: string[];
  evidence: Record<string, string>;
  capturedAt: string;
};
type Profile = {
  _id: string;
  siteId: string;
  name: string;
  loginUrl: string;
  startUrl?: string;
  username: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successSelector?: string;
  successUrl?: string;
};
type WorkerInfo = {
  _id: string;
  status: string;
  online: boolean;
  heartbeatAt: string;
  error?: string;
  currentScanId?: string;
};
type ScanEvent = {
  _id: string;
  scanId: string;
  level: 'info' | 'warning' | 'error';
  at: string;
  phase: string;
  message: string;
  url?: string;
};
type Summary = { sites: number; scans: number; issues: number; recent: Scan[] };
const nav = [
  { id: 'dashboard', name: 'Overview', icon: Activity },
  { id: 'websites', name: 'Websites', icon: Globe2 },
  { id: 'scans', name: 'Scans', icon: ScanSearch },
  { id: 'routes', name: 'Routes', icon: RouteIcon },
  { id: 'errors', name: 'Errors', icon: AlertTriangle },
  { id: 'reports', name: 'Reports', icon: FileBarChart2 },
  { id: 'settings', name: 'Settings', icon: Settings },
];
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || `HTTP ${res.status}`);
  return data as T;
}
const date = (input?: string) => (input ? new Date(input).toLocaleString() : '—');
const Status = ({ value }: { value: string }) => (
  <span className={`pill ${value}`}>{value.replaceAll('_', ' ')}</span>
);
const Empty = ({ message }: { message: string }) => (
  <div className="muted p-14 text-center text-sm">{message}</div>
);
const Field = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="field-label">{title}</span>
    {children}
  </label>
);
export default function Dashboard({ section }: { section: string }) {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]),
    [scans, setScans] = useState<Scan[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [pages, setPages] = useState<Page[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [summary, setSummary] = useState<Summary | null>(null),
    [workers, setWorkers] = useState<WorkerInfo[]>([]),
    [liveScan, setLiveScan] = useState(''),
    [scanEvents, setScanEvents] = useState<ScanEvent[]>([]),
    [pending, setPending] = useState(''),
    [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [dark, setDark] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(''),
    [resultScan, setResultScan] = useState(''),
    [resultSite, setResultSite] = useState(''),
    [deleteSite, setDeleteSite] = useState<Site | null>(null),
    [deleteConfirmation, setDeleteConfirmation] = useState(''),
    [deleteHistory, setDeleteHistory] = useState(false),
    [resultProfile, setResultProfile] = useState('*'),
    [showAdd, setShowAdd] = useState(false),
    [editingSite, setEditingSite] = useState(''),
    [showProfile, setShowProfile] = useState(false),
    [editingProfile, setEditingProfile] = useState(''),
    [detail, setDetail] = useState<Page | null>(null),
    [html, setHtml] = useState(''),
    [investigation, setInvestigation] = useState<{ hints: string[]; logTail: string } | null>(null),
    [patch, setPatch] = useState(''),
    [proposal, setProposal] = useState(''),
    [comparison, setComparison] = useState<{ current: Page; previous: Page | null } | null>(null),
    [previousHtml, setPreviousHtml] = useState('');
  const [siteForm, setSiteForm] = useState({
    name: '',
    baseUrl: '',
    sourcePath: '',
    environment: 'local',
    allowedHosts: '',
    allowedPorts: '',
    allowLocalhost: true,
    allowPrivateNetwork: false,
    ignoreHTTPSErrors: false,
    captureTraces: false,
    captureHealthy: false,
    allowPassiveLivewire: false,
    allowLivewireBackground: false,
    scheduleMinutes: 0,
    maxPages: 0,
    discoveryMode: 'navigation' as 'navigation' | 'all-links',
    maxDepth: 3,
    concurrency: 2,
    timeoutMs: 30000,
    authorized: false,
  });
  const [profileForm, setProfileForm] = useState({
    siteId: '',
    name: '',
    loginUrl: '',
    startUrl: '',
    username: '',
    password: '',
    usernameSelector: '',
    passwordSelector: '',
    submitSelector: '',
    successUrl: '',
    successSelector: '',
  });
  const [selectedSite, setSelectedSite] = useState(''),
    [selectedProfile, setSelectedProfile] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [s, sc, i, p, pr, su, w] = await Promise.all([
        api<Site[]>('sites'),
        api<Scan[]>('scans'),
        api<Issue[]>('issues'),
        api<Page[]>('pages'),
        api<Profile[]>('profiles'),
        api<Summary>('summary'),
        api<WorkerInfo[]>('workers'),
      ]);
      setSites(s);
      setScans(sc);
      setIssues(i);
      setPages(p);
      setProfiles(pr);
      setSummary(su);
      setWorkers(w);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      if (section === 'scans') {
        const id = query.get('site') || '';
        if (id) setSelectedSite(id);
      }
      if (section === 'routes' || section === 'errors') {
        setResultSite(query.get('site') || '');
        setResultScan(query.get('scan') || '');
      }
    }, 0);
    return () => window.clearTimeout(initial);
  }, [section]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      const value = localStorage.getItem('auditor-theme') === 'dark';
      setDark(value);
      document.documentElement.classList.toggle('dark', value);
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);
  async function signOut() {
    setPending('logout');
    setError('');
    try {
      await api('logout', 'POST', {});
      router.replace('/login');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending('');
    }
  }
  function toggleTheme() {
    setDark((v) => {
      const n = !v;
      localStorage.setItem('auditor-theme', n ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', n);
      return n;
    });
  }
  async function invoke<T>(fn: () => Promise<T>, success: string, key = 'action') {
    if (pending) return;
    setPending(key);
    try {
      setError('');
      await fn();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending('');
    }
  }
  function editSite(site: Site) {
    setEditingSite(site._id);
    setSiteForm({
      name: site.name,
      baseUrl: site.baseUrl,
      sourcePath: site.sourcePath || '',
      environment: site.environment,
      allowedHosts: site.allowedHosts.filter((h) => h !== new URL(site.baseUrl).hostname).join(', '),
      allowedPorts: site.allowedPorts
        .filter(
          (p) =>
            p !==
            (new URL(site.baseUrl).port
              ? Number(new URL(site.baseUrl).port)
              : new URL(site.baseUrl).protocol === 'https:'
                ? 443
                : 80),
        )
        .join(', '),
      allowLocalhost: site.allowLocalhost,
      allowPrivateNetwork: site.allowPrivateNetwork,
      ignoreHTTPSErrors: site.ignoreHTTPSErrors,
      captureTraces: site.captureTraces || false,
      captureHealthy: site.captureHealthy || false,
      allowPassiveLivewire: site.allowPassiveLivewire || false,
      allowLivewireBackground: site.allowLivewireBackground || false,
      scheduleMinutes: site.scheduleMinutes || 0,
      maxPages: site.maxPages,
      discoveryMode: site.discoveryMode || 'navigation',
      maxDepth: site.maxDepth,
      concurrency: site.concurrency,
      timeoutMs: site.timeoutMs,
      authorized: false,
    });
    setShowAdd(true);
  }
  function openNewSite() {
    setEditingSite('');
    setSiteForm({
      name: '',
      baseUrl: '',
      sourcePath: '',
      environment: 'local',
      allowedHosts: '',
      allowedPorts: '',
      allowLocalhost: true,
      allowPrivateNetwork: false,
      ignoreHTTPSErrors: false,
      captureTraces: false,
      captureHealthy: false,
      allowPassiveLivewire: false,
      allowLivewireBackground: false,
      scheduleMinutes: 0,
      maxPages: 0,
      discoveryMode: 'navigation',
      maxDepth: 3,
      concurrency: 2,
      timeoutMs: 30000,
      authorized: false,
    });
    setShowAdd(true);
  }
  function newProfile(siteId: string) {
    const site = sites.find((item) => item._id === siteId);
    setSelectedSite(siteId);
    setEditingProfile('');
    setProfileForm({
      siteId,
      name: '',
      loginUrl: site?.baseUrl || '',
      startUrl: site?.baseUrl || '',
      username: '',
      password: '',
      usernameSelector: '',
      passwordSelector: '',
      submitSelector: '',
      successSelector: '',
      successUrl: '',
    });
    setShowProfile(true);
  }
  function filteredPageCount(scanId: string): number {
    return pages.filter((item) => item.scanId === scanId).length;
  }
  function name(siteId: string) {
    return sites.find((s) => s._id === siteId)?.name || 'Unknown site';
  }
  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    await invoke(
      async () => {
        const u = new URL(
          /^https?:\/\//.test(siteForm.baseUrl) ? siteForm.baseUrl : `https://${siteForm.baseUrl}`,
        );
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
          throw Error('Enter a valid HTTP(S) website URL without embedded credentials');
        if (!siteForm.name.trim()) throw Error('Website name is required');
        if (
          siteForm.environment === 'production' &&
          (siteForm.allowPassiveLivewire || siteForm.allowLivewireBackground)
        )
          throw Error('Livewire compatibility modes are limited to authorized local or staging sites');
        const portEntries = siteForm.allowedPorts.split(/[\s,]+/).filter(Boolean);
        if (portEntries.some((value) => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535))
          throw Error('Allowed ports must be integers between 1 and 65535');
        await api(editingSite ? `sites/${editingSite}` : 'sites', editingSite ? 'PATCH' : 'POST', {
          ...siteForm,
          allowedHosts: siteForm.allowedHosts.split(/[,\s]+/).filter(Boolean),
          allowedPorts: siteForm.allowedPorts
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number),
          baseUrl: u.href,
        });
        setShowAdd(false);
        setEditingSite('');
      },
      editingSite ? 'Website updated' : 'Website registered',
    );
  }
  function editProfile(profile: Profile) {
    setSelectedSite(profile.siteId);
    setEditingProfile(profile._id);
    setProfileForm({
      siteId: profile.siteId,
      name: profile.name,
      loginUrl: profile.loginUrl,
      startUrl: profile.startUrl || '',
      username: profile.username,
      password: '',
      usernameSelector: profile.usernameSelector || '',
      passwordSelector: profile.passwordSelector || '',
      submitSelector: profile.submitSelector || '',
      successSelector: profile.successSelector || '',
      successUrl: profile.successUrl || '',
    });
    setShowProfile(true);
  }
  async function removeWebsite() {
    if (!deleteSite || deleteConfirmation !== deleteSite.name) return;
    await invoke(async () => {
      await api(`sites/${deleteSite._id}`, 'DELETE', { confirmName: deleteConfirmation, deleteHistory });
      if (selectedSite === deleteSite._id) {
        setSelectedSite('');
        setSelectedProfile('');
      }
      setDeleteSite(null);
    }, 'Website, profiles, and any approved history removed');
  }
  async function addProfile(e: React.FormEvent) {
    e.preventDefault();
    await invoke(async () => {
      const siteId = selectedSite || profileForm.siteId;
      if (editingProfile) {
        await api(`profiles/${editingProfile}`, 'PATCH', {
          ...profileForm,
          password: profileForm.password || undefined,
        });
        setSelectedProfile(editingProfile);
      } else {
        const created = await api<{ _id: string }>('profiles', 'POST', { ...profileForm, siteId });
        setSelectedProfile(created._id);
      }
      setSelectedSite(siteId);
      setShowProfile(false);
      setEditingProfile('');
      setProfileForm({ ...profileForm, password: '' });
    }, 'Authentication profile saved');
  }
  async function start(siteId: string, authProfileId?: string) {
    await invoke(
      async () => {
        const result = await api<{ scanId: string; existing: boolean }>('scans/start', 'POST', {
          siteId,
          authProfileId,
        });
        setScanEvents([]);
        setLiveScan(result.scanId);
      },
      'Scan queued or existing active scan reused; select the terminal icon to inspect progress.',
      'start',
    );
  }
  async function retry(page: Page) {
    if (pending) return;
    setPending('retry');
    try {
      const result = await api<{ scanId: string; existing: boolean }>('scans/retry', 'POST', {
        pageId: page._id,
      });
      setError('');
      setNotice(
        result.existing
          ? `An identical verification is already active (scan ${result.scanId.slice(-8)}).`
          : `Verification queued (scan ${result.scanId.slice(-8)}). Result will update only after a real revisit.`,
      );
      setLiveScan(result.scanId);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending('');
    }
  }
  async function action(scanId: string, act: string) {
    await invoke(
      () => api(`scans/action/${scanId}`, 'POST', { action: act }),
      `Scan ${act} requested`,
      `action-${scanId}`,
    );
  }
  async function compare(page: Page) {
    try {
      const data = await api<{ current: Page; previous: Page | null }>(`compare?pageId=${page._id}`);
      setComparison(data);
      if (data.previous?.evidence.rendered) {
        const old = await api<{ html: string }>(
          `evidence?key=${encodeURIComponent(data.previous.evidence.rendered)}&format=text`,
        );
        setPreviousHtml(old.html);
      } else setPreviousHtml('');
    } catch (e) {
      setError(String(e));
    }
  }
  async function inspect(page: Page) {
    try {
      const data = await api<{ hints: string[]; logTail: string }>(`investigate?pageId=${page._id}`);
      setInvestigation(data);
    } catch (e) {
      setError(String(e));
    }
  }
  async function propose(page: Page) {
    await invoke(async () => {
      const data = await api<{ proposalId: string }>('fixes/preview', 'POST', { pageId: page._id, patch });
      setProposal(data.proposalId);
    }, 'Patch passed git apply --check; explicit approval is required before applying.');
  }
  async function apply() {
    if (
      !proposal ||
      !confirm('Apply the reviewed patch to the authorized local project? A backup will be created.')
    )
      return;
    await invoke(async () => {
      await api('fixes/apply', 'POST', { proposalId: proposal, acknowledged: true });
      setProposal('');
    }, 'Approved change applied. Retry the page to verify it.');
  }
  async function viewPage(page: Page) {
    setDetail(page);
    setComparison(null);
    setPreviousHtml('');
    setHtml('');
    setInvestigation(null);
    setPatch('');
    setProposal('');
    if (page.evidence.rendered)
      try {
        const res = await api<{ html: string }>(
          `evidence?key=${encodeURIComponent(page.evidence.rendered)}&format=text`,
        );
        setHtml(res.html);
      } catch (e) {
        setError(String(e));
      }
  }
  useEffect(() => {
    if (!liveScan) return;
    let running = true;
    async function poll() {
      try {
        const events = await api<ScanEvent[]>(`events?scanId=${liveScan}`);
        if (running) setScanEvents(events);
      } catch (e) {
        if (running) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      running = false;
      clearInterval(timer);
    };
  }, [liveScan]);
  const profileLabel = (profileId?: string, snapshot?: string) =>
    !profileId
      ? 'Unauthenticated'
      : snapshot || profiles.find((p) => p._id === profileId)?.name || 'Profile unavailable';
  const profileForRecord = (profileId?: string, scanId?: string) =>
    profileLabel(profileId, scans.find((s) => s._id === scanId)?.authProfileName);
  const workerOnline = workers.some((w) => w.online && w.status === 'ready');
  const active = (siteId: string, profileId?: string) =>
    scans.some(
      (sc) =>
        sc.siteId === siteId &&
        (sc.authProfileId || '') === (profileId || '') &&
        ['queued', 'running', 'paused'].includes(sc.status),
    );
  const elapsed = (start: string) =>
    updatedAt ? Math.max(0, Math.floor((updatedAt.getTime() - new Date(start).getTime()) / 1000)) : 0;
  const filtered = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  const title = nav.find((v) => v.id === section)?.name || 'Dashboard';
  return (
    <div className="auditor-shell flex min-h-screen">
      {mobile && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobile(false)} />
      )}
      <aside
        className={`${mobile ? 'translate-x-0' : '-translate-x-full'} line sidebar-glass fixed z-40 flex h-screen w-64 flex-col border-r transition-transform lg:translate-x-0`}
      >
        <div className="line flex items-center gap-3 border-b p-6">
          <div className="brand-icon rounded-xl p-2 text-white">
            <Activity size={22} />
          </div>
          <div>
            <div className="font-bold tracking-tight">Website Auditor</div>
            <div className="muted text-[11px]">UNIVERSAL DIAGNOSTICS</div>
          </div>
        </div>
        <div className="muted px-4 pt-6 pb-2 text-[11px] font-bold tracking-[.15em] uppercase">Workspace</div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((v) => (
            <Link
              key={v.id}
              href={v.id === 'dashboard' ? '/' : `/${v.id}`}
              onClick={() => {
                setMobile(false);
                setSearch('');
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-medium ${section === v.id ? 'nav-active' : 'hover-surface muted'}`}
            >
              <v.icon size={18} />
              {v.name}
              {v.id === 'errors' && issues.length > 0 && (
                <span className="ml-auto rounded-md bg-[#ffe2e3] px-2 text-xs text-[#b32838]">
                  {issues.length}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="line border-t p-4">
          <div className="surface p-3">
            <div className="flex items-center gap-2 text-xs font-bold">
              <ShieldCheck size={15} className="text-green-500" /> Restricted access
            </div>
            <div className="muted mt-2 text-xs leading-relaxed">
              Scans run on approved targets. Evidence stays private in RustFS.
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 lg:ml-64">
        <header className="line topbar-glass sticky top-0 isolate z-40 flex h-[73px] items-center gap-4 border-b px-5 lg:px-9">
          <button onClick={() => setMobile(true)} className="lg:hidden">
            <Menu size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="muted text-[11px]">
              WORKSPACE <ChevronRight size={12} className="inline" /> {title.toUpperCase()}
            </div>
            <div className="text-sm font-semibold">{title}</div>
          </div>
          <div
            className={`hidden items-center gap-2 text-xs sm:flex ${workerOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${workerOnline ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />
            {workerOnline ? 'Worker online' : 'Worker unavailable'}
          </div>
          <button title="Refresh" className="btn" onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </button>
          <button title="Toggle theme" className="btn" onClick={toggleTheme}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            title="Sign out"
            className="btn"
            onClick={() => {
              if (confirm('Sign out of Website Auditor? This does not sign out of audited websites.'))
                void signOut();
            }}
          >
            <LogOut size={16} />
          </button>
        </header>
        <div className="relative z-0 mx-auto max-w-[1560px] space-y-7 p-5 md:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="page-h">{section === 'dashboard' ? 'Command center' : title}</h1>
              <p className="muted mt-1 text-sm">
                {section === 'dashboard'
                  ? 'Live visibility into website reliability across environments.'
                  : 'Monitor, investigate and verify authorized website behavior.'}
              </p>
            </div>
            <div className="flex gap-2">
              {section === 'websites' && (
                <button className="btn primary" onClick={openNewSite}>
                  <Plus size={16} /> Add website
                </button>
              )}
              {section === 'scans' && (
                <span className="pill running">
                  <Radio size={12} className="mr-1" /> Live queue monitor
                </span>
              )}
            </div>
          </div>
          {error && (
            <div
              role="alert"
              className="flex justify-between gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
            >
              {error}
              <button onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="flex justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-200"
            >
              {notice}
              <button onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {section === 'dashboard' && (
            <>
              <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2">
                  <Radio size={16} className={workerOnline ? 'text-emerald-500' : 'text-amber-500'} />
                  <strong className="text-sm">
                    Worker {workerOnline ? 'online' : 'offline or initializing'}
                  </strong>
                  <span className="muted text-xs">
                    {' '}
                    · {workers.filter((w) => w.online).length} active process(es)
                  </span>
                </div>
                <Link href="/scans" className="btn">
                  Open queue monitor <ChevronRight size={13} />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {[
                  { k: 'Registered websites', v: summary?.sites ?? '—', icon: Globe2 },
                  { k: 'Total scans', v: summary?.scans ?? '—', icon: ScanSearch },
                  { k: 'Open issues', v: summary?.issues ?? '—', icon: AlertTriangle },
                  {
                    k: 'Active scans',
                    v: scans.filter((s) => ['queued', 'running', 'paused'].includes(s.status)).length,
                    icon: Activity,
                  },
                ].map((card) => (
                  <div key={card.k} className="surface p-5">
                    <div className="flex items-center justify-between">
                      <span className="muted text-[12px]">{card.k}</span>
                      <card.icon size={19} className="text-[#6a8be1]" />
                    </div>
                    <div className="mt-4 text-[30px] font-bold tracking-tight">{card.v}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
                <section className="surface">
                  <div className="line border-b p-5">
                    <h2 className="section-h">Recent scans</h2>
                  </div>
                  {scans.length ? (
                    scans.slice(0, 7).map((sc) => (
                      <div
                        key={sc._id}
                        className="line flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{name(sc.siteId)}</div>
                          <div className="muted mt-1 text-xs">
                            {date(sc.createdAt)} · {sc.progress.visited} pages checked
                          </div>
                        </div>
                        <Status value={sc.status} />
                      </div>
                    ))
                  ) : (
                    <Empty message="No scans yet. Register a website and start the first audit." />
                  )}
                </section>
                <section className="surface">
                  <div className="line flex justify-between border-b p-5">
                    <h2 className="section-h">Recent errors</h2>
                    <Link className="text-xs text-blue-500" href="/errors">
                      View all
                    </Link>
                  </div>
                  {issues.slice(0, 6).map((issue) => (
                    <div key={issue._id} className="line border-b p-4 last:border-b-0">
                      <div className="truncate text-[13px] font-medium">{issue.message}</div>
                      <div className="muted mt-1 truncate text-xs">{issue.url}</div>
                    </div>
                  ))}
                  {!issues.length && <Empty message="No open issues have been recorded." />}
                </section>
              </div>
            </>
          )}
          {section === 'websites' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="muted text-xs">{sites.length} registered environments</div>
                <button className="btn" onClick={() => newProfile(sites[0]?._id || '')}>
                  <Plus size={14} /> Profiles
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sites.map((site) => (
                  <article key={site._id} className="surface p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="rounded-lg bg-[#e9efff] p-2 text-blue-500 dark:bg-[#2b3b66]">
                        <Globe2 size={21} />
                      </div>
                      <span className="pill running">{site.environment}</span>
                    </div>
                    <h3 className="mt-5 font-bold">{site.name}</h3>
                    <a
                      href={site.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="muted mt-1 flex items-center gap-1 text-xs break-all hover:underline"
                    >
                      {site.baseUrl}
                      <ExternalLink size={13} />
                    </a>
                    <div className="muted line mt-5 space-y-2 border-t pt-4 text-xs">
                      <div className="flex justify-between">
                        <span>Pages limit</span>
                        <b>{site.maxPages === 0 ? 'Auto (bounded)' : site.maxPages}</b>
                      </div>
                      <div className="flex justify-between">
                        <span>Crawl depth</span>
                        <b>{site.maxDepth}</b>
                      </div>
                      <div className="flex justify-between">
                        <span>Concurrency</span>
                        <b>{site.concurrency}</b>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        disabled={!!pending}
                        className="btn primary"
                        onClick={() => {
                          const siteProfiles = profiles.filter((profile) => profile.siteId === site._id);
                          setSelectedSite(site._id);
                          setSelectedProfile(siteProfiles.length === 1 ? siteProfiles[0]._id : '');
                          router.push(`/scans?site=${encodeURIComponent(site._id)}`);
                        }}
                      >
                        {pending === 'start' ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <Play size={13} />
                        )}{' '}
                        Configure scan
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          newProfile(site._id);
                        }}
                      >
                        <ShieldCheck size={14} /> Profiles
                      </button>
                      <button className="btn" onClick={() => editSite(site)}>
                        <Settings size={14} /> Edit
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => {
                          setDeleteSite(site);
                          setDeleteConfirmation('');
                          setDeleteHistory(false);
                        }}
                      >
                        <AlertTriangle size={14} /> Delete
                      </button>
                    </div>
                  </article>
                ))}
                {!sites.length && (
                  <div className="surface col-span-full">
                    <Empty message="No websites yet. Register a site to begin monitoring." />
                  </div>
                )}
              </div>
            </>
          )}
          {section === 'scans' && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="surface flex items-center gap-3 p-4">
                  <div
                    className={`rounded-xl p-3 ${workerOnline ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}
                  >
                    <Radio size={19} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {workerOnline ? 'Worker connected' : 'Worker not ready'}
                    </div>
                    <div className="muted text-xs">
                      {workers.filter((w) => w.online).length} online · heartbeat every 5s
                    </div>
                  </div>
                </div>
                <div className="surface flex items-center gap-3 p-4">
                  <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
                    <Layers3 size={19} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {scans.filter((s) => s.status === 'queued').length} queued
                    </div>
                    <div className="muted text-xs">Waiting to be claimed</div>
                  </div>
                </div>
                <div className="surface flex items-center gap-3 p-4">
                  <div className="rounded-xl bg-violet-500/10 p-3 text-violet-500">
                    <Activity size={19} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {scans.filter((s) => ['running', 'paused'].includes(s.status)).length} in progress
                    </div>
                    <div className="muted text-xs">Status refreshes every 2.5 seconds</div>
                  </div>
                </div>
              </div>
              {!workerOnline && (
                <div role="status" className="surface flex items-start gap-3 border-amber-500/40! p-4">
                  <AlertCircle size={19} className="shrink-0 text-amber-500" />
                  <div className="text-sm">
                    <strong>Background worker is unavailable.</strong>
                    <p className="muted mt-1">
                      Queued scans will not start until <code>npm run worker</code> is running. Check its
                      terminal, MongoDB connectivity and RustFS initialization.{' '}
                      {workers[0]?.error && `Worker error: ${workers[0].error}`}
                    </p>
                  </div>
                </div>
              )}
              <div className="surface flex flex-wrap items-end gap-3 p-4">
                <div className="w-full sm:w-72">
                  <Field title="Website">
                    <select
                      className="input"
                      value={selectedSite}
                      onChange={(e) => {
                        setSelectedSite(e.target.value);
                        const siteProfiles = profiles.filter((profile) => profile.siteId === e.target.value);
                        setSelectedProfile(siteProfiles.length === 1 ? siteProfiles[0]._id : '');
                      }}
                    >
                      <option value="">Select website</option>
                      {sites.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="w-full sm:w-64">
                  <Field title="Authentication profile">
                    <select
                      className="input"
                      value={selectedProfile}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                    >
                      <option value="">Unauthenticated</option>
                      {profiles
                        .filter((p) => p.siteId === selectedSite)
                        .map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                {selectedSite && (
                  <div
                    className="w-full rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-400/10 dark:text-blue-200"
                    role="status"
                  >
                    <strong>{selectedProfile ? 'Authenticated scan' : 'Public scan'}</strong>
                    <span className="ml-2 break-all">
                      {selectedProfile
                        ? `Login will be verified before crawling · ${profiles.find((profile) => profile._id === selectedProfile)?.startUrl || sites.find((site) => site._id === selectedSite)?.baseUrl || ''}`
                        : 'Only publicly accessible routes will be discovered. No credentials will be submitted.'}
                    </span>
                  </div>
                )}
                <button
                  className="btn primary"
                  disabled={!selectedSite || !!pending || active(selectedSite, selectedProfile)}
                  onClick={() => void start(selectedSite, selectedProfile || undefined)}
                >
                  {pending === 'start' ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}{' '}
                  {active(selectedSite, selectedProfile) ? 'Scan already active' : 'Start scan'}
                </button>
              </div>
              <section className="surface table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Website / Created</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Outcome</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans
                      .filter((scan) => !selectedSite || scan.siteId === selectedSite)
                      .map((sc) => (
                        <tr key={sc._id}>
                          <td>
                            <strong>{name(sc.siteId)}</strong>
                            <div className="muted mt-1 text-xs">{date(sc.createdAt)}</div>
                            <div className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-300">
                              {profileLabel(sc.authProfileId, sc.authProfileName)}
                            </div>
                            {sc.authenticatedLandingUrl && (
                              <div
                                className="muted mt-1 max-w-56 truncate text-[11px]"
                                title={sc.authenticatedLandingUrl}
                              >
                                Authenticated start: {sc.authenticatedLandingUrl}
                              </div>
                            )}
                            {sc.error && <div className="mt-1 max-w-72 text-xs text-red-600">{sc.error}</div>}
                          </td>
                          <td>
                            <Status value={sc.status} />
                          </td>
                          <td className="min-w-52">
                            <div className="mb-2 text-xs">
                              {sc.progress.visited} visited / {sc.progress.discovered} discovered ·{' '}
                              {filteredPageCount(sc._id)} shown{' '}
                              <span className="muted">· {sc.phase || sc.status}</span>
                            </div>
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${Math.min(100, (100 * sc.progress.visited) / Math.max(1, sc.progress.discovered))}%`,
                                }}
                              />
                            </div>
                            <div className="muted mt-1 max-w-52 truncate text-[11px]">
                              {sc.progress.currentUrl ||
                                (['queued', 'running'].includes(sc.status)
                                  ? sc.status === 'queued'
                                    ? `Waiting ${elapsed(sc.createdAt)}s for worker`
                                    : `Starting ${elapsed(sc.startedAt || sc.createdAt)}s`
                                  : '')}
                            </div>
                            {sc.status === 'queued' && elapsed(sc.createdAt) > 30 && (
                              <div className="mt-1 text-xs text-amber-600">
                                {workerOnline
                                  ? 'Worker busy or pickup delayed'
                                  : 'Worker offline · not claimed'}
                              </div>
                            )}
                            {sc.status === 'running' &&
                              elapsed(sc.lastActivityAt || sc.startedAt || sc.createdAt) > 120 && (
                                <div className="mt-1 text-xs text-amber-600">
                                  No activity for over 120 seconds — inspect logs
                                </div>
                              )}
                          </td>
                          <td>
                            <span className="text-green-600">{sc.progress.passed} passed</span>
                            <div className="text-red-500">{sc.progress.failed} failed</div>
                            {sc.progress.warnings > 0 && (
                              <div className="text-amber-600">{sc.progress.warnings} warnings</div>
                            )}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {sc.status === 'running' && (
                                <button
                                  disabled={!!pending}
                                  title="Pause"
                                  className="btn"
                                  onClick={() => void action(sc._id, 'pause')}
                                >
                                  <Pause size={14} />
                                </button>
                              )}
                              {sc.status === 'paused' && (
                                <button
                                  disabled={!!pending}
                                  title="Resume"
                                  className="btn"
                                  onClick={() => void action(sc._id, 'resume')}
                                >
                                  <Play size={14} />
                                </button>
                              )}
                              {['running', 'paused', 'queued'].includes(sc.status) && (
                                <button
                                  disabled={!!pending}
                                  title={
                                    sc.status === 'queued'
                                      ? 'Cancel queued scan immediately'
                                      : 'Request cancellation after active page'
                                  }
                                  className="btn danger"
                                  onClick={() => void action(sc._id, 'cancel')}
                                >
                                  {pending === `action-${sc._id}` ? (
                                    <LoaderCircle size={13} className="animate-spin" />
                                  ) : (
                                    <Square size={13} />
                                  )}
                                </button>
                              )}
                              <button
                                className="btn"
                                title="Show only this scan's routes"
                                onClick={() =>
                                  router.push(
                                    `/routes?site=${encodeURIComponent(sc.siteId)}&scan=${encodeURIComponent(sc._id)}`,
                                  )
                                }
                              >
                                <RouteIcon size={14} />
                              </button>
                              <button
                                className="btn"
                                title="Show only this scan's errors"
                                onClick={() =>
                                  router.push(
                                    `/errors?site=${encodeURIComponent(sc.siteId)}&scan=${encodeURIComponent(sc._id)}`,
                                  )
                                }
                              >
                                <AlertTriangle size={14} />
                              </button>
                              <button
                                title="Live activity logs"
                                aria-label="View scan activity"
                                className="btn"
                                onClick={() => {
                                  setScanEvents([]);
                                  setLiveScan(liveScan === sc._id ? '' : sc._id);
                                }}
                              >
                                <Terminal size={14} />
                              </button>
                              {sc.reportKeys && (
                                <a
                                  className="btn"
                                  title="HTML report"
                                  href={`/api/report/${sc._id}?format=html`}
                                >
                                  <Download size={14} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!scans.length && <Empty message="No scans have been queued." />}
              </section>
              <section className="surface overflow-hidden">
                <div className="line flex items-center justify-between gap-2 border-b p-4">
                  <h2 className="section-h flex items-center gap-2">
                    <Terminal size={17} /> Live scan activity
                  </h2>
                  <span className="muted text-xs">
                    {liveScan ? `Scan ${liveScan.slice(-8)}` : 'Select the terminal icon on a scan'}
                  </span>
                </div>
                {!liveScan ? (
                  <Empty message="Select a scan to inspect startup, page visits, warnings and worker errors." />
                ) : (
                  <div className="log-stream max-h-[360px] space-y-2 overflow-y-auto p-4">
                    {scanEvents.length === 0 ? (
                      <div className="muted text-xs">
                        No events yet. Worker may not have claimed the scan.
                      </div>
                    ) : (
                      scanEvents.map((e) => (
                        <div key={e._id} className="flex items-start gap-3 text-xs">
                          <span className="shrink-0 tabular-nums opacity-50">
                            {new Date(e.at).toLocaleTimeString()}
                          </span>
                          <span
                            className={
                              e.level === 'error'
                                ? 'text-rose-400'
                                : e.level === 'warning'
                                  ? 'text-amber-400'
                                  : 'text-cyan-300'
                            }
                          >
                            {e.phase}
                          </span>
                          <span className="break-all text-slate-200">
                            {e.message}
                            {e.url && <span className="block opacity-60">{e.url}</span>}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {(section === 'routes' || section === 'errors') && (
            <>
              <div className="surface flex items-center gap-3 p-4">
                <Search size={18} className="muted" />
                <input
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder={
                    section === 'routes' ? 'Filter discovered routes…' : 'Search errors, URL or category…'
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Filter results by website"
                  className="input max-w-48"
                  value={resultSite}
                  onChange={(e) => {
                    setResultSite(e.target.value);
                    setResultScan('');
                  }}
                >
                  <option value="">All websites</option>
                  {sites.map((site) => (
                    <option key={site._id} value={site._id}>
                      {site.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter results by authentication profile"
                  className="input max-w-52"
                  value={resultProfile}
                  onChange={(e) => setResultProfile(e.target.value)}
                >
                  <option value="*">All profiles</option>
                  <option value="">Unauthenticated</option>
                  {profiles.map((profile) => (
                    <option key={profile._id} value={profile._id}>
                      {profile.name} · {name(profile.siteId)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter results by scan"
                  className="input max-w-48"
                  value={resultScan}
                  onChange={(e) => setResultScan(e.target.value)}
                >
                  <option value="">All scans</option>
                  {scans
                    .filter((scan) => !resultSite || scan.siteId === resultSite)
                    .map((scan) => (
                      <option key={scan._id} value={scan._id}>
                        {name(scan.siteId)} · {scan._id.slice(-8)}
                      </option>
                    ))}
                </select>
                <Filter size={17} className="muted" />
              </div>
              {section === 'errors' && (resultSite || resultScan) && (
                <div className="surface flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="muted text-xs">
                    Bulk export failed page diagnostics within the selected website or scan.
                  </span>
                  <div className="flex gap-2">
                    <a
                      className="btn"
                      href={`/api/exports/errors?${new URLSearchParams({ ...(resultSite ? { siteId: resultSite } : {}), ...(resultScan ? { scanId: resultScan } : {}), format: 'csv' })}`}
                    >
                      <Download size={13} /> Errors CSV
                    </a>
                    <a
                      className="btn"
                      href={`/api/exports/errors?${new URLSearchParams({ ...(resultSite ? { siteId: resultSite } : {}), ...(resultScan ? { scanId: resultScan } : {}), format: 'json' })}`}
                    >
                      <Download size={13} /> Errors JSON
                    </a>
                  </div>
                </div>
              )}
              <div className="surface table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {(section === 'routes'
                        ? ['Page', 'Status', 'Result', 'Time', 'Evidence']
                        : ['Issue', 'Website', 'HTTP', 'Status', 'Last seen', 'Actions']
                      ).map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section === 'routes'
                      ? pages
                          .filter(
                            (p) =>
                              filtered(`${p.url} ${p.title}`) &&
                              (!resultSite || p.siteId === resultSite) &&
                              (!resultScan || p.scanId === resultScan) &&
                              (resultProfile === '*' || (p.authProfileId || '') === resultProfile),
                          )
                          .map((page) => (
                            <tr key={page._id}>
                              <td>
                                <div className="max-w-[380px] truncate font-semibold">
                                  {page.title || page.url}
                                </div>
                                <div className="muted mt-1 max-w-[380px] truncate text-xs">{page.url}</div>
                                <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-300">
                                  {profileForRecord(page.authProfileId, page.scanId)} · Scan{' '}
                                  {page.scanId.slice(-8)}
                                </div>
                              </td>
                              <td>{page.status || '—'}</td>
                              <td>
                                <Status value={page.classification} />
                              </td>
                              <td>{page.durationMs} ms</td>
                              <td>
                                <div className="flex gap-2">
                                  <button onClick={() => void viewPage(page)} className="btn">
                                    <Eye size={14} /> Details
                                  </button>
                                  <button className="btn" onClick={() => void retry(page)}>
                                    <RefreshCw size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                      : resultScan
                        ? pages
                            .filter(
                              (page) =>
                                page.classification === 'failed' &&
                                page.scanId === resultScan &&
                                (!resultSite || page.siteId === resultSite) &&
                                (resultProfile === '*' || (page.authProfileId || '') === resultProfile) &&
                                filtered(
                                  `${page.url} ${page.issues.map((issue) => issue.message).join(' ')}`,
                                ),
                            )
                            .map((page) => (
                              <tr key={page._id}>
                                <td>
                                  <div className="font-semibold">
                                    {page.issues.map((issue) => issue.message).join('; ') || 'Page failed'}
                                  </div>
                                  <div className="muted max-w-96 truncate text-xs">{page.url}</div>
                                </td>
                                <td>{name(page.siteId)}</td>
                                <td>{page.status || '—'}</td>
                                <td>
                                  <Status value={page.classification} />
                                </td>
                                <td className="text-xs">{date(page.capturedAt)}</td>
                                <td>
                                  <div className="flex gap-2">
                                    <button className="btn" onClick={() => void viewPage(page)}>
                                      <Eye size={14} /> Details
                                    </button>
                                    <button className="btn" onClick={() => void retry(page)}>
                                      <RefreshCw size={14} /> Retry
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                        : issues
                            .filter(
                              (i) =>
                                filtered(`${i.url} ${i.category} ${i.message}`) &&
                                (!resultSite || i.siteId === resultSite) &&
                                (resultProfile === '*' || (i.authProfileId || '') === resultProfile),
                            )
                            .map((i) => (
                              <tr key={i._id}>
                                <td>
                                  <div className="max-w-96 truncate font-semibold">{i.message}</div>
                                  <div className="muted max-w-96 truncate text-xs">{i.url}</div>
                                  <div className="muted mt-1 text-xs">
                                    {i.category} · {i.occurrences} occurrence(s) ·{' '}
                                    {profileForRecord(i.authProfileId, i.scanId)}
                                  </div>
                                </td>
                                <td>{name(i.siteId)}</td>
                                <td>{i.latestHttpStatus || '—'}</td>
                                <td>
                                  <Status value={i.status} />
                                </td>
                                <td>{date(i.lastDetectedAt)}</td>
                                <td>
                                  <div className="flex gap-2">
                                    <button
                                      className="btn"
                                      onClick={() => {
                                        const p = pages.find((p) => p._id === i.pageId);
                                        if (p) void viewPage(p);
                                        else
                                          setError(
                                            'Historical page detail is outside the currently loaded page limit.',
                                          );
                                      }}
                                    >
                                      <Eye size={14} />
                                    </button>
                                    <button
                                      className="btn"
                                      onClick={() =>
                                        void invoke(
                                          () => api('scans/retry', 'POST', { pageId: i.pageId }),
                                          'Verification queued',
                                        )
                                      }
                                    >
                                      <RefreshCw size={14} />
                                    </button>
                                    <button
                                      className="btn"
                                      title="Manual review"
                                      onClick={() =>
                                        void invoke(
                                          () => api(`issues/${i._id}`, 'PATCH', { status: 'manual_review' }),
                                          'Marked for manual review',
                                        )
                                      }
                                    >
                                      <Clock4 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                  </tbody>
                </table>
                {(section === 'routes' ? pages : issues).length === 0 && (
                  <Empty message="No results yet. Run a scan to populate diagnostics." />
                )}
              </div>
            </>
          )}
          {section === 'reports' && (
            <ReportExplorer scans={scans} sites={sites} onOpen={(p) => void viewPage(p)} />
          )}
          {section === 'settings' && (
            <div className="grid gap-5 md:grid-cols-2">
              <section className="surface p-6">
                <HardDrive className="text-blue-500" />
                <h2 className="mt-4 font-semibold">Storage and services</h2>
                <p className="muted mt-2 text-sm">
                  MongoDB provides scan persistence and worker leases. RustFS stores private HTML, images and
                  reports. Configure connection credentials in the project environment, not in the browser.
                </p>
                <div className="mt-4 space-y-2 text-xs">
                  <div>
                    MongoDB: <strong>server configured</strong>
                  </div>
                  <div>
                    Live worker: <strong>{workerOnline ? 'online' : 'not ready'}</strong>
                  </div>
                  <div>
                    Last UI refresh: <strong>{updatedAt?.toLocaleTimeString() || '—'}</strong>
                  </div>
                  <div>
                    RustFS: <strong>server configured</strong>
                  </div>
                  <div>
                    Secrets: <strong>environment-only</strong>
                  </div>
                </div>
              </section>
              <section className="surface p-6">
                <ShieldCheck className="text-blue-500" />
                <h2 className="mt-4 font-semibold">Safety defaults</h2>
                <p className="muted mt-2 text-sm">
                  Sites require explicit authorization, scoped hosts and ports, and opt-in private or loopback
                  access. Browser scans avoid form submissions except for configured authentication.
                </p>
                <div className="muted mt-4 text-xs">
                  Configuration updates require editing environment variables and restarting services.
                </div>
              </section>
              <DatabaseCleanup sites={sites} onClean={refresh} />
            </div>
          )}
          {loading && <div className="muted text-sm">Loading data…</div>}
        </div>
      </main>
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowAdd(false);
          }}
        >
          <form
            onSubmit={addSite}
            className="surface max-h-[92vh] w-full max-w-2xl space-y-4 overflow-auto p-6"
          >
            <div className="flex justify-between">
              <h2 className="text-xl font-bold">{editingSite ? 'Edit website' : 'Register a website'}</h2>
              <button type="button" onClick={() => setShowAdd(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field title="Website name">
                <input
                  minLength={2}
                  maxLength={100}
                  required
                  className="input"
                  value={siteForm.name}
                  onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                />
              </Field>
              <Field title="Environment">
                <select
                  className="input"
                  value={siteForm.environment}
                  onChange={(e) => setSiteForm({ ...siteForm, environment: e.target.value })}
                >
                  <option>local</option>
                  <option>staging</option>
                  <option>production</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field title="Base URL">
                  <input
                    type="text"
                    inputMode="url"
                    placeholder="https://example.com or localhost:3100"
                    required
                    className="input"
                    minLength={4}
                    value={siteForm.baseUrl}
                    onChange={(e) => setSiteForm({ ...siteForm, baseUrl: e.target.value })}
                  />
                </Field>
              </div>
              <Field title="Local source directory (optional)">
                <input
                  className="input"
                  placeholder="/home/user/Documents/Project-Sites/Local/app"
                  value={siteForm.sourcePath}
                  onChange={(e) => setSiteForm({ ...siteForm, sourcePath: e.target.value })}
                />
              </Field>
              <Field title="Extra hosts or URLs (comma-separated)">
                <input
                  className="input"
                  placeholder="https://tenant.example.test, admin.example.test"
                  value={siteForm.allowedHosts}
                  onChange={(e) => setSiteForm({ ...siteForm, allowedHosts: e.target.value })}
                />
              </Field>
              <p className="muted -mt-1 text-xs md:col-span-2">
                Different login hosts are allowed only when explicitly listed here. Create a separate
                authentication profile for each login and, if necessary, a separate website entry per origin.
                A login URL never silently expands the crawl scope.
              </p>
              <Field title="Extra allowed ports">
                <input
                  className="input"
                  placeholder="5173, 8443"
                  value={siteForm.allowedPorts}
                  onChange={(e) => setSiteForm({ ...siteForm, allowedPorts: e.target.value })}
                />
              </Field>
              <Field title="Page limit">
                <select
                  className="input"
                  value={siteForm.maxPages === 0 ? 'auto' : 'custom'}
                  onChange={(e) => setSiteForm({ ...siteForm, maxPages: e.target.value === 'auto' ? 0 : 50 })}
                >
                  <option value="auto">Auto — all discoverable (safety capped)</option>
                  <option value="custom">Custom maximum</option>
                </select>
                {siteForm.maxPages !== 0 && (
                  <input
                    type="number"
                    className="input mt-2"
                    min={1}
                    max={10000}
                    value={siteForm.maxPages}
                    onChange={(e) => setSiteForm({ ...siteForm, maxPages: Number(e.target.value) })}
                  />
                )}
                <p className="muted mt-1 text-xs">
                  Auto scans up to AUTO_PAGE_SAFETY_LIMIT (default 10,000), within crawl depth and time
                  budget.
                </p>
              </Field>
              <Field title="Discovery scope">
                <select
                  className="input"
                  value={siteForm.discoveryMode}
                  onChange={(e) =>
                    setSiteForm({
                      ...siteForm,
                      discoveryMode: e.target.value as 'navigation' | 'all-links',
                    })
                  }
                >
                  <option value="navigation">Navigation only (recommended)</option>
                  <option value="all-links">Navigation + internal content links</option>
                </select>
                <p className="muted mt-1 text-xs">
                  Navigation only follows header, menu and sidebar links. Both modes exclude assets, API paths
                  and destructive URLs. Explicit route imports are separate.
                </p>
              </Field>
              {(
                [
                  ['maxDepth', 'Crawl depth'],
                  ['concurrency', 'Browser concurrency'],
                  ['timeoutMs', 'Request timeout (ms)'],
                  ['scheduleMinutes', 'Schedule interval (minutes, 0=off)'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} title={label}>
                  <input
                    type="number"
                    className="input"
                    min={key === 'maxDepth' || key === 'scheduleMinutes' ? 0 : 1}
                    max={
                      key === 'maxDepth'
                        ? 10
                        : key === 'concurrency'
                          ? 6
                          : key === 'scheduleMinutes'
                            ? 10080
                            : 120000
                    }
                    value={siteForm[key]}
                    onChange={(e) => setSiteForm({ ...siteForm, [key]: Number(e.target.value) })}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              {(
                [
                  ['allowLocalhost', 'Allow localhost / .test loopback'],
                  ['allowPrivateNetwork', 'Allow private LAN IPs'],
                  ['ignoreHTTPSErrors', 'Ignore invalid TLS for this site'],
                  ['captureTraces', 'Save Playwright traces'],
                  ['captureHealthy', 'Capture healthy pages too'],
                  ['allowPassiveLivewire', 'Allow passive Livewire initialization (local/staging only)'],
                  ['allowLivewireBackground', 'Browser-faithful Livewire requests (local/staging only)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={
                      (key === 'allowPassiveLivewire' || key === 'allowLivewireBackground') &&
                      siteForm.environment === 'production'
                    }
                    checked={siteForm[key]}
                    onChange={(e) => setSiteForm({ ...siteForm, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            {(siteForm.allowPassiveLivewire || siteForm.allowLivewireBackground) && (
              <p className="rounded-lg border border-amber-300/50 bg-amber-100/50 p-3 text-xs text-amber-950 dark:bg-amber-900/20 dark:text-amber-200">
                Browser-faithful mode allows same-origin Livewire component requests initiated by the page,
                even when their payload includes updates or methods. The auditor does not click
                submit/save/delete controls, but page-generated requests can still mutate data. Only use with
                authorized non-production test accounts and disposable data. Passive mode retains stricter
                filtering. The two modes are optional; strict blocking remains the default.
              </p>
            )}
            <label className="line flex items-start gap-2 border-t pt-4 text-xs">
              <input
                type="checkbox"
                required
                checked={siteForm.authorized}
                onChange={(e) => setSiteForm({ ...siteForm, authorized: e.target.checked })}
              />
              <span>
                I own or have explicit permission to audit this site and its configured target scope.
              </span>
            </label>
            <button className="btn primary w-full" type="submit" disabled={!!pending}>
              {pending === 'action' && <LoaderCircle size={14} className="animate-spin" />}
              {editingSite ? 'Update website' : 'Save website'}
            </button>
          </form>
        </div>
      )}
      {deleteSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-site-title"
            className="surface w-full max-w-lg space-y-4 p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="delete-site-title" className="text-lg font-bold">
                Delete website
              </h2>
              <button type="button" className="btn" onClick={() => setDeleteSite(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-sm">
              Remove <strong>{deleteSite.name}</strong> and its authentication profiles. Active scans must be
              cancelled first. Historical evidence will be deleted only if explicitly selected.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteHistory}
                onChange={(e) => setDeleteHistory(e.target.checked)}
              />
              Delete historical scans, issues, and RustFS evidence
            </label>
            <Field title={`Type ${deleteSite.name} to confirm`}>
              <input
                className="input"
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setDeleteSite(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirmation !== deleteSite.name || !!pending}
                className="btn danger"
                onClick={() => void removeWebsite()}
              >
                Delete website
              </button>
            </div>
          </div>
        </div>
      )}
      {showProfile && (
        <div
          className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-black/60 p-3 sm:items-center sm:justify-center sm:p-5"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowProfile(false);
          }}
        >
          <form
            onSubmit={addProfile}
            className="surface mx-auto my-auto max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-xl space-y-4 overflow-y-auto overscroll-contain p-4 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-6"
          >
            <div className="flex justify-between">
              <h2 className="text-xl font-bold">{editingProfile ? 'Edit profile' : 'Add profile'}</h2>
              <button type="button" onClick={() => setShowProfile(false)}>
                <X size={20} />
              </button>
            </div>
            {!!selectedSite && profiles.some((profile) => profile.siteId === selectedSite) && (
              <div className="surface-secondary max-h-32 space-y-1 overflow-y-auto rounded-lg p-2 text-xs">
                {profiles
                  .filter((profile) => profile.siteId === selectedSite)
                  .map((profile) => (
                    <div className="flex items-center justify-between gap-2" key={profile._id}>
                      <div className="min-w-0 truncate">
                        <strong>{profile.name}</strong> · {profile.loginUrl}
                      </div>
                      <button type="button" className="btn shrink-0" onClick={() => editProfile(profile)}>
                        Edit
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {editingProfile && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditingProfile('');
                  newProfile(selectedSite);
                }}
              >
                Create another profile
              </button>
            )}
            <Field title="Website">
              <select
                className="input"
                required
                value={selectedSite || profileForm.siteId}
                disabled={!!editingProfile}
                onChange={(e) => {
                  setSelectedSite(e.target.value);
                  const target = sites.find((site) => site._id === e.target.value);
                  setProfileForm({
                    ...profileForm,
                    siteId: e.target.value,
                    loginUrl: editingProfile ? profileForm.loginUrl : target?.baseUrl || '',
                    startUrl: editingProfile ? profileForm.startUrl : target?.baseUrl || '',
                  });
                }}
              >
                <option value="">Select website</option>
                {sites.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Profile name">
              <input
                required
                className="input"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
              />
            </Field>
            <Field title="Login URL">
              <input
                type="url"
                required
                className="input"
                placeholder="https://site.test/login"
                value={profileForm.loginUrl}
                onChange={(e) => setProfileForm({ ...profileForm, loginUrl: e.target.value })}
              />
            </Field>
            <Field title="Authenticated start URL (optional, can differ from login)">
              <input
                type="url"
                className="input"
                placeholder="https://tenant.example.test/dashboard"
                value={profileForm.startUrl}
                onChange={(e) => setProfileForm({ ...profileForm, startUrl: e.target.value })}
              />
            </Field>
            <p className="muted text-xs">
              Both login and start URL must be in the website&apos;s approved host/port scope. Different
              applications should use separate profiles or registrations.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field title="Username">
                <input
                  required
                  className="input"
                  value={profileForm.username}
                  onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
                />
              </Field>
              <Field title="Password">
                <input
                  type="password"
                  required={!editingProfile}
                  placeholder={editingProfile ? 'Leave blank to keep current password' : ''}
                  className="input"
                  value={profileForm.password}
                  onChange={(e) => setProfileForm({ ...profileForm, password: e.target.value })}
                />
              </Field>
            </div>
            <details className="text-sm">
              <summary className="muted cursor-pointer">Advanced form selectors</summary>
              <div className="mt-3 space-y-2">
                {(
                  [
                    'usernameSelector',
                    'passwordSelector',
                    'submitSelector',
                    'successSelector',
                    'successUrl',
                  ] as const
                ).map((k) => (
                  <Field key={k} title={k}>
                    <input
                      className="input"
                      value={profileForm[k]}
                      onChange={(e) => setProfileForm({ ...profileForm, [k]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            </details>
            <p className="muted text-xs">
              Credentials are encrypted at rest with AUTH_ENCRYPTION_KEY, and never included in reports.
            </p>
            <button className="btn primary w-full" disabled={!!pending}>
              {pending === 'action' && <LoaderCircle size={14} className="animate-spin" />}Save profile
            </button>
          </form>
        </div>
      )}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65">
          <div className="h-full w-full max-w-3xl space-y-5 overflow-y-auto bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold">Page diagnostics</h2>
                <p className="muted mt-2 text-xs break-all">{detail.url}</p>
                <p className="mt-1 text-xs text-blue-600 dark:text-blue-300">
                  {profileForRecord(detail.authProfileId, detail.scanId)} · Scan {detail.scanId.slice(-8)}
                </p>
              </div>
              <button className="btn" onClick={() => setDetail(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Status value={detail.classification} />
              <span className="muted text-xs">
                HTTP {detail.status ?? '—'} · {detail.durationMs} ms
              </span>
              <button className="btn" onClick={() => void retry(detail)}>
                <RefreshCw size={13} /> Retry
              </button>
              <a className="btn" href={detail.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> Open live
              </a>
              <button className="btn" onClick={() => void navigator.clipboard.writeText(detail.url)}>
                <Copy size={13} /> Copy
              </button>
              <button className="btn" onClick={() => void inspect(detail)}>
                <Search size={13} /> Investigate
              </button>
              <button className="btn" onClick={() => void compare(detail)}>
                Before/after
              </button>
            </div>
            <section className="surface p-4">
              <h3 className="section-h mb-3">Detected issues</h3>
              {(detail.warnings || []).map((message, index) => (
                <div
                  key={`warning-${index}`}
                  className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  Scan limitation: {message}
                </div>
              ))}
              {detail.issues.length ? (
                detail.issues.map((v, i) => (
                  <div
                    key={i}
                    className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
                  >
                    {v.category}: {v.message}
                  </div>
                ))
              ) : (
                <div className="text-sm text-green-600">No blocking issues in this visit.</div>
              )}
            </section>
            {comparison && (
              <section className="surface space-y-3 p-4">
                <h3 className="section-h">Before / after verification</h3>
                {comparison.previous ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="muted mb-1 text-xs">
                          Previous ({date(comparison.previous.capturedAt)})
                        </div>
                        <Status value={comparison.previous.classification} />
                        <div className="mt-2">
                          HTTP {comparison.previous.status ?? 'network'} · {comparison.previous.durationMs}ms
                        </div>
                      </div>
                      <div>
                        <div className="muted mb-1 text-xs">Current ({date(detail.capturedAt)})</div>
                        <Status value={detail.classification} />
                        <div className="mt-2">
                          HTTP {detail.status ?? 'network'} · {detail.durationMs}ms
                        </div>
                      </div>
                    </div>
                    {comparison.previous.evidence.screenshot && detail.evidence.screenshot && (
                      <div className="grid grid-cols-2 gap-3">
                        <Image
                          unoptimized
                          width={800}
                          height={500}
                          alt="Previous captured screenshot"
                          className="line h-auto rounded-md border"
                          src={`/api/evidence?key=${encodeURIComponent(comparison.previous.evidence.screenshot)}`}
                        />
                        <Image
                          unoptimized
                          width={800}
                          height={500}
                          alt="Current captured screenshot"
                          className="line h-auto rounded-md border"
                          src={`/api/evidence?key=${encodeURIComponent(detail.evidence.screenshot)}`}
                        />
                      </div>
                    )}
                    {previousHtml && (
                      <details className="text-sm">
                        <summary className="cursor-pointer">Compare saved HTML source</summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <pre className="log-pre">{previousHtml.slice(0, 20000)}</pre>
                          <pre className="log-pre">{html.slice(0, 20000)}</pre>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="muted text-sm">
                    No earlier visit for this exact URL/profile has been recorded.
                  </p>
                )}
              </section>
            )}
            {investigation && (
              <section className="surface space-y-3 p-4">
                <h3 className="section-h">Local source investigation</h3>
                {investigation.hints.map((h, i) => (
                  <p key={i} className="text-sm">
                    {h}
                  </p>
                ))}
                <details>
                  <summary className="muted cursor-pointer text-xs">
                    View redacted application log tail
                  </summary>
                  <pre className="log-pre mt-2">{investigation.logTail}</pre>
                </details>
                <Field title="Paste a unified Git diff for review (no automatic edits)">
                  <textarea
                    rows={6}
                    className="input font-mono"
                    value={patch}
                    onChange={(e) => {
                      setPatch(e.target.value);
                      setProposal('');
                    }}
                  />
                </Field>
                <button className="btn" disabled={!patch} onClick={() => void propose(detail)}>
                  Validate patch
                </button>
                {proposal && (
                  <div className="flex items-center gap-2">
                    <span className="muted text-xs">Proposed change ready for explicit approval.</span>
                    <button className="btn primary" onClick={() => void apply()}>
                      Approve and apply
                    </button>
                  </div>
                )}
              </section>
            )}
            <EvidenceViewer key={detail._id} page={detail} renderedHtml={html} />
            <p className="muted text-xs">
              Opening a live page uses your existing browser session. For a separately authenticated
              Playwright browser, use <code>npm run live</code> as documented in README.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
