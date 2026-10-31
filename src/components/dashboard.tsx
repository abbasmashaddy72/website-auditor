'use client';
import ReportExplorer from '@/app/reports/_components/report-explorer';
import ConfigBackupPanel from '@/app/websites/_components/config-backup-panel';
import DatabaseCleanup from './database-cleanup';
import EvidenceViewer from './evidence-viewer';
import ManualReviewPanel from '@/app/manual-review/_components/manual-review-panel';
import WorkerManager from './worker-manager';
import OverviewAnalytics from '@/app/_overview/overview-analytics';
import { WebsiteGrid } from '@/app/websites/_components/website-grid';
import { OverviewKpis } from '@/app/_overview/overview-kpis';
import {
  ActionButton,
  ConfirmDialog,
  Dialog,
  Tooltip,
  StatusBadge,
  EmptyState,
  FormField,
  TabBar,
  InlineAlert,
  IconButton,
  DestructiveButton,
  DataTable,
  SlideOver,
} from './ui';
import type { TableColumn } from './ui';
import type { PageTiming } from '../lib/performance';
import { batchCompletion, type BatchSummary } from '../lib/batch-summary';
import { findingSeverity, groupActiveFindings } from '../lib/finding-severity';
import { FindingGroups } from '@/app/errors/_components/finding-groups';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useCallback, useState } from 'react';
import {
  Activity,
  Globe2,
  ScanSearch,
  Route as RouteIcon,
  AlertTriangle,
  CheckCircle2,
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
  RotateCcw,
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
  rerunOfScanId?: string;
  batchId?: string;
  mode?: 'crawl' | 'retry' | 'import';
  options?: Partial<{ maxPages: number; maxDepth: number; concurrency: number; timeoutMs: number }>;
  endedAt?: string;
  progress: {
    discovered: number;
    visited: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped?: number;
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
  lastVerifiedAt?: string;
  lastResolution?: { at: string; scanId: string; pageId: string; httpStatus?: number };
  reviewState?: string;
  reviewHistory?: Array<{
    id: string;
    at: string;
    actor: string;
    decision: string;
    from: string;
    to: string;
    reviewState: string;
    comment: string;
  }>;
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
  archivedAt?: string;
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
type Summary = {
  sites: number;
  scans: number;
  activeScans: number;
  issues: number;
  errorIssues?: number;
  warningIssues?: number;
  resolved: number;
  manualReview: number;
  recent: Scan[];
};
const nav = [
  { id: 'dashboard', name: 'Overview', icon: Activity },
  { id: 'websites', name: 'Websites', icon: Globe2 },
  { id: 'scans', name: 'Scans', icon: ScanSearch },
  { id: 'routes', name: 'Routes', icon: RouteIcon },
  { id: 'errors', name: 'Active Errors', icon: AlertTriangle },
  { id: 'resolved', name: 'Resolved Findings', icon: CheckCircle2 },
  { id: 'manual-review', name: 'Manual Review', icon: Clock4 },
  { id: 'reports', name: 'Reports', icon: FileBarChart2 },
  { id: 'settings', name: 'Settings', icon: Settings },
  { id: 'workers', name: 'Workers', icon: Radio },
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
// Existing usages now delegate to the shared design-system components.
const Status = ({ value }: { value: string }) => <StatusBadge status={value} />;
const Empty = EmptyState;
const Field = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <FormField label={title}>{children}</FormField>
);
export default function Dashboard({ section }: { section: string }) {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]),
    [scans, setScans] = useState<Scan[]>([]),
    [batches, setBatches] = useState<BatchSummary[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [resolvedFindings, setResolvedFindings] = useState<Issue[]>([]),
    [reviewFindings, setReviewFindings] = useState<Issue[]>([]),
    [pages, setPages] = useState<Page[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [archivedProfiles, setArchivedProfiles] = useState<Profile[]>([]),
    [summary, setSummary] = useState<Summary | null>(null),
    [workers, setWorkers] = useState<WorkerInfo[]>([]),
    [liveScan, setLiveScan] = useState(''),
    [scanEvents, setScanEvents] = useState<ScanEvent[]>([]),
    [pending, setPending] = useState(''),
    [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [syncWarning, setSyncWarning] = useState(''),
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
  const [findingCounts, setFindingCounts] = useState<{
    all: number;
    errors: number;
    warnings: number;
    groups: number;
  } | null>(null);
  const [routeTab, setRouteTab] = useState<'all' | 'successful' | 'warnings' | 'failed' | 'resolved'>('all');
  const [routePage, setRoutePage] = useState(0);
  const [routeSort, setRouteSort] = useState<{ id: string; direction: 'asc' | 'desc' }>({
    id: 'seen',
    direction: 'desc',
  });
  const [routeResult, setRouteResult] = useState<{
    items: Page[];
    total: number;
    counts: Record<'all' | 'successful' | 'warnings' | 'failed' | 'resolved', number>;
    page: number;
    limit: number;
  } | null>(null);
  const [findingTab, setFindingTab] = useState<'all' | 'errors' | 'warnings' | 'grouped'>('all');
  const [scanTab, setScanTab] = useState<'all' | 'direct' | 'batch' | 'running' | 'completed' | 'failed'>(
    'all',
  );
  const [expandedBatches, setExpandedBatches] = useState<string[]>([]);
  const [batchPages, setBatchPages] = useState<
    Record<string, { items: Scan[]; total: number; nextSkip: number | null }>
  >({});
  const [batchLoading, setBatchLoading] = useState<string>('');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [selectedFailedPages, setSelectedFailedPages] = useState<string[]>([]);
  const [profileInitial, setProfileInitial] = useState('');
  const [profileToArchive, setProfileToArchive] = useState<Profile | null>(null);
  const [profileToRestore, setProfileToRestore] = useState<Profile | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [siteInitial, setSiteInitial] = useState('');
  const [bulkRetryOpen, setBulkRetryOpen] = useState(false);
  const [retryAllSiteIssues, setRetryAllSiteIssues] = useState(false);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  const [rerunScanId, setRerunScanId] = useState('');
  const [cancelScanId, setCancelScanId] = useState('');
  const [rerunOptions, setRerunOptions] = useState<
    Partial<{ maxPages: number; maxDepth: number; concurrency: number; timeoutMs: number }>
  >({});
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
    // Polling is best effort. A single transient request failure must not become
    // a red actionable error while an independent export successfully downloads.
    const results = await Promise.allSettled([
      api<Site[]>('sites'),
      api<Scan[]>('scans'),
      api<BatchSummary[]>('scans/batches'),
      api<Issue[]>('issues'),
      api<Issue[]>('issues?status=resolved'),
      api<Page[]>('pages'),
      api<Profile[]>('profiles'),
      api<Profile[]>('profiles?archived=1'),
      api<Summary>('summary'),
      api<WorkerInfo[]>('workers'),
      api<Issue[]>('issues?status=review_history'),
    ] as const);
    if (results[0].status === 'fulfilled') setSites(results[0].value);
    if (results[1].status === 'fulfilled') setScans(results[1].value);
    if (results[2].status === 'fulfilled') setBatches(results[2].value);
    if (results[3].status === 'fulfilled') setIssues(results[3].value);
    if (results[4].status === 'fulfilled') setResolvedFindings(results[4].value);
    if (results[5].status === 'fulfilled') setPages(results[5].value);
    if (results[6].status === 'fulfilled') setProfiles(results[6].value);
    if (results[7].status === 'fulfilled') setArchivedProfiles(results[7].value);
    if (results[8].status === 'fulfilled') setSummary(results[8].value);
    if (results[9].status === 'fulfilled') setWorkers(results[9].value);
    if (results[10].status === 'fulfilled') setReviewFindings(results[10].value);
    const errors = results.filter((result) => result.status === 'rejected');
    setSyncWarning(
      errors.length
        ? `Background refresh temporarily missed ${errors.length} of ${results.length} sources; last known values remain displayed.`
        : '',
    );
    if (errors.length < results.length) setUpdatedAt(new Date());
    setLoading(false);
  }, []);
  useEffect(() => {
    // A sticky toolbar must not conceal the incoming section heading.
    window.scrollTo(0, 0);
  }, [section]);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      if (section === 'scans') {
        const id = query.get('site') || '';
        if (id) setSelectedSite(id);
      }
      if (section === 'routes' || section === 'errors' || section === 'resolved') {
        setResultSite(query.get('site') || '');
        setResultScan(query.get('scan') || '');
        if (section === 'routes') {
          const tab = query.get('status') || 'all';
          if (['all', 'successful', 'warnings', 'failed', 'resolved'].includes(tab))
            setRouteTab(tab as typeof routeTab);
        }
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
  useEffect(() => {
    if (section !== 'routes') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({
        status: routeTab,
        profile: resultProfile,
        page: String(routePage),
        sort: routeSort.id,
        dir: routeSort.direction,
      });
      if (resultSite) params.set('siteId', resultSite);
      if (resultScan) params.set('scanId', resultScan);
      if (search.trim()) params.set('q', search.trim());
      try {
        const response = await fetch(`/api/routes?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Route request HTTP ${response.status}`);
        if (!controller.signal.aborted) setRouteResult(payload);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    section,
    routeTab,
    routePage,
    routeSort.id,
    routeSort.direction,
    resultSite,
    resultScan,
    resultProfile,
    search,
    updatedAt,
  ]);

  useEffect(() => {
    if (section !== 'errors') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ profile: resultProfile });
      if (resultSite) params.set('siteId', resultSite);
      if (resultScan) params.set('scanId', resultScan);
      if (search.trim()) params.set('q', search.trim());
      try {
        const response = await fetch(`/api/issues/counts?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Finding count HTTP ${response.status}`);
        if (!controller.signal.aborted) setFindingCounts(data);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [section, resultSite, resultScan, resultProfile, search, updatedAt]);

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
      if (success) setNotice(success);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending('');
    }
  }
  function editSite(site: Site) {
    setEditingSite(site._id);
    const initialForm = {
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
    };
    setSiteForm(initialForm);
    setSiteInitial(JSON.stringify(initialForm));
    setShowAdd(true);
  }
  function openNewSite() {
    setEditingSite('');
    const initialForm = {
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
      discoveryMode: 'navigation' as const,
      maxDepth: 3,
      concurrency: 2,
      timeoutMs: 30000,
      authorized: false,
    };
    setSiteForm(initialForm);
    setSiteInitial(JSON.stringify(initialForm));
    setShowAdd(true);
  }
  function newProfile(siteId: string) {
    const site = sites.find((item) => item._id === siteId);
    setSelectedSite(siteId);
    setEditingProfile('');
    const initialProfile = {
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
    };
    setProfileForm(initialProfile);
    setProfileInitial(JSON.stringify(initialProfile));
    setShowProfile(true);
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
        setSiteInitial(JSON.stringify(siteForm));
        setShowAdd(false);
        setEditingSite('');
      },
      editingSite ? 'Website updated' : 'Website registered',
    );
  }
  function editProfile(profile: Profile) {
    setSelectedSite(profile.siteId);
    setEditingProfile(profile._id);
    const initialProfile = {
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
    };
    setProfileForm(initialProfile);
    setProfileInitial(JSON.stringify(initialProfile));
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
  async function archiveProfile(profile: Profile) {
    await invoke(
      async () => {
        await api(`profiles/${profile._id}`, 'DELETE', { confirmName: profile.name });
        setProfileToArchive(null);
        setShowProfile(false);
        setProfileInitial(JSON.stringify(profileForm));
      },
      'Profile archived; existing scans and evidence preserved',
      'archive-profile',
    );
  }
  async function restoreProfile(profile: Profile) {
    await invoke(
      async () => {
        await api(`profiles/restore/${profile._id}`, 'POST', { confirmName: profile.name });
        setProfileToRestore(null);
        setShowProfile(false);
        setProfileInitial(JSON.stringify(profileForm));
      },
      'Profile restored; previous history preserved',
      'restore-profile',
    );
  }
  const siteDirty = JSON.stringify(siteForm) !== siteInitial;
  const profileDirty = JSON.stringify(profileForm) !== profileInitial;
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
      setProfileInitial(JSON.stringify({ ...profileForm, password: '' }));
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
  async function openHistoricalEvidence(pageId: string) {
    try {
      const page = await api<Page>(`pages/${encodeURIComponent(pageId)}`);
      await viewPage(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open preserved evidence');
    }
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
    if (!proposal) return;
    await invoke(async () => {
      await api('fixes/apply', 'POST', { proposalId: proposal, acknowledged: true });
      setProposal('');
    }, 'Approved change applied. Retry the page to verify it.');
  }
  async function rerunScan(scanId: string) {
    await invoke(
      async () => {
        const result = await api<{ scanId: string; existing: boolean }>(`scans/rerun/${scanId}`, 'POST', {
          options: rerunOptions,
        });
        setLiveScan(result.scanId);
      },
      'Rerun queued as a new execution. Original history preserved.',
      'rerun',
    );
  }
  const eligibleIssues = issues.filter(
    (i) =>
      ['open', 'reopened'].includes(i.status) &&
      (!resultSite || i.siteId === resultSite) &&
      (!resultScan || i.scanId === resultScan) &&
      (resultProfile === '*' || (i.authProfileId || '') === resultProfile) &&
      `${i.url} ${i.category} ${i.message}`.toLowerCase().includes(search.toLowerCase()),
  );
  const effectiveSelectedIssues = selectedIssues.filter((id) =>
    eligibleIssues.some((item) => item._id === id),
  );
  const eligibleFailedPages = pages.filter(
    (page) =>
      page.classification === 'failed' &&
      page.scanId === resultScan &&
      (!resultSite || page.siteId === resultSite) &&
      (resultProfile === '*' || (page.authProfileId || '') === resultProfile) &&
      `${page.url} ${page.issues.map((i) => i.message).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const effectiveSelectedPages = selectedFailedPages.filter((id) =>
    eligibleFailedPages.some((page) => page._id === id),
  );
  async function fetchBatchPage(batchId: string, reset = false) {
    if (batchLoading) return;
    const previous = reset ? undefined : batchPages[batchId];
    if (previous?.nextSkip === null) return;
    setBatchLoading(batchId);
    try {
      const skip = previous?.nextSkip ?? 0;
      const response = await api<{ items: Scan[]; total: number; nextSkip: number | null }>(
        `scans/batch/${batchId}?skip=${skip}`,
      );
      setBatchPages((current) => {
        const older = reset ? [] : current[batchId]?.items || [];
        const combined = new Map([...older, ...response.items].map((item) => [item._id, item]));
        return {
          ...current,
          [batchId]: { items: [...combined.values()], total: response.total, nextSkip: response.nextSkip },
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cannot load batch jobs');
    } finally {
      setBatchLoading('');
    }
  }
  function toggleBatch(batchId: string) {
    if (expandedBatches.includes(batchId)) {
      setExpandedBatches((current) => current.filter((id) => id !== batchId));
    } else {
      setExpandedBatches((current) => [...current, batchId]);
      if (!batchPages[batchId]) void fetchBatchPage(batchId);
    }
  }
  async function bulkRetryIssues() {
    await invoke(
      async () => {
        const counts = { selected: 0, queued: 0, active: 0, ineligible: 0, failed: 0 };
        let batchId: string | undefined;
        if (retryAllSiteIssues && resultSite && !resultScan) {
          let cursor: string | null = null;
          for (let batch = 0; batch < 200; batch++) {
            const batchResult: {
              batchId: string;
              selected: number;
              queued: number;
              alreadyActive: number;
              ineligible: number;
              failed: number;
              nextCursor: string | null;
            } = await api<{
              batchId: string;
              selected: number;
              queued: number;
              alreadyActive: number;
              ineligible: number;
              failed: number;
              nextCursor: string | null;
            }>('scans/retry-bulk', 'POST', {
              allEligible: true,
              siteId: resultSite,
              ...(cursor ? { cursor } : {}),
              ...(batchId ? { batchId } : {}),
            });
            batchId = batchResult.batchId;
            counts.selected += batchResult.selected;
            counts.ineligible += batchResult.ineligible;
            counts.queued += batchResult.queued;
            counts.active += batchResult.alreadyActive;
            counts.failed += batchResult.failed;
            setNotice(`Server-side retry batch ${batch + 1} processed`);
            cursor = batchResult.nextCursor;
            if (!cursor) break;
            if (batch === 199) throw Error('Safety budget reached; start another scoped retry later');
          }
          setNotice(
            `${counts.selected} selected · ${counts.queued} new job(s) · ${counts.active} reused active · ${counts.ineligible} ineligible · ${counts.failed} failed. Batch ${batchId?.slice(-8) || '—'}.`,
          );
          setSelectedIssues([]);
          setBulkRetryOpen(false);
          setRetryAllSiteIssues(false);
          return;
        }
        const scope = resultScan ? effectiveSelectedPages : effectiveSelectedIssues;
        for (let i = 0; i < scope.length; i += 50) {
          const ids = scope.slice(i, i + 50);
          const result = await api<{
            batchId: string;
            selected: number;
            queued: number;
            alreadyActive: number;
            ineligible: number;
            failed: number;
          }>(
            'scans/retry-bulk',
            'POST',
            resultScan
              ? { pageIds: ids, scanId: resultScan, ...(batchId ? { batchId } : {}) }
              : { issueIds: ids, ...(batchId ? { batchId } : {}) },
          );
          batchId = result.batchId;
          counts.selected += result.selected;
          counts.ineligible += result.ineligible;
          counts.queued += result.queued;
          counts.active += result.alreadyActive;
          counts.failed += result.failed;
          setNotice(`Retry batch ${Math.ceil((i + 1) / 50)} / ${Math.ceil(scope.length / 50)} processed`);
        }
        setNotice(
          `${counts.selected} selected · ${counts.queued} new job(s) · ${counts.active} reused active · ${counts.ineligible} ineligible · ${counts.failed} failed. Batch ${batchId?.slice(-8) || '—'}.`,
        );
        setSelectedIssues([]);
        setSelectedFailedPages([]);
        setBulkRetryOpen(false);
        setRetryAllSiteIssues(false);
      },
      '',
      'bulk-retry',
    );
  }
  async function bulkMoveToReview() {
    await invoke(
      async () => {
        let updated = 0,
          failed = 0;
        for (let i = 0; i < effectiveSelectedIssues.length; i += 50) {
          const result = await api<{ updated: number; failed: number }>('issues/review', 'POST', {
            issueIds: effectiveSelectedIssues.slice(i, i + 50),
            decision: 'submit',
            comment: reviewComment,
          });
          updated += result.updated;
          failed += result.failed;
          setNotice(
            `Manual Review batch ${Math.ceil((i + 1) / 50)} / ${Math.ceil(effectiveSelectedIssues.length / 50)} processed`,
          );
        }
        setNotice(`${updated} moved to Manual Review; ${failed} not changed`);
        setSelectedIssues([]);
        setReviewComment('');
        setBulkReviewOpen(false);
      },
      '',
      'bulk-review',
    );
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
  const scanEntries = new Map<string, Scan>(scans.map((scan) => [scan._id, scan]));
  for (const result of Object.values(batchPages)) {
    for (const scan of result.items) {
      if (!scanEntries.has(scan._id)) scanEntries.set(scan._id, scan);
    }
  }
  const scanScope = [...scanEntries.values()]
    .filter((scan) => !selectedSite || scan.siteId === selectedSite)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const scanTabs = [
    { key: 'all', label: 'All scans', count: scanScope.length },
    { key: 'direct', label: 'Direct', count: scanScope.filter((s) => !s.batchId).length },
    {
      key: 'batch',
      label: 'Recent batches',
      count: batches.filter((b) => !selectedSite || b.websites.includes(selectedSite)).length,
    },
    {
      key: 'running',
      label: 'Running',
      count: scanScope.filter((s) => ['queued', 'running', 'paused'].includes(s.status)).length,
    },
    {
      key: 'completed',
      label: 'Completed',
      count: scanScope.filter((s) => s.status.startsWith('completed')).length,
    },
    { key: 'failed', label: 'Failed', count: scanScope.filter((s) => s.status === 'failed').length },
  ] as const;
  const filteredScans = scanScope.filter(
    (s) =>
      scanTab === 'all' ||
      (scanTab === 'direct' && !s.batchId) ||
      (scanTab === 'batch' && Boolean(s.batchId)) ||
      (scanTab === 'running' && ['queued', 'running', 'paused'].includes(s.status)) ||
      (scanTab === 'completed' && s.status.startsWith('completed')) ||
      (scanTab === 'failed' && s.status === 'failed'),
  );
  const resolvedMatches = resolvedFindings.filter(
    (issue) =>
      (!resultSite || issue.siteId === resultSite) &&
      (resultProfile === '*' || (issue.authProfileId || '') === resultProfile) &&
      `${issue.url} ${issue.category} ${issue.message}`.toLowerCase().includes(search.toLowerCase()),
  );
  const resolvedColumns: TableColumn<Issue>[] = [
    {
      id: 'finding',
      header: 'Original issue / route',
      accessor: (issue) => issue.message,
      render: (issue) => (
        <>
          <div className="max-w-lg font-semibold break-words">{issue.message}</div>
          <div className="muted max-w-lg text-xs break-all">{issue.url}</div>
          <div className="muted mt-1 text-xs">
            {issue.category} · {issue.occurrences} original occurrence(s)
          </div>
        </>
      ),
    },
    {
      id: 'website',
      header: 'Website / profile',
      accessor: (issue) => name(issue.siteId),
      render: (issue) => (
        <>
          {name(issue.siteId)}
          <div className="muted mt-1 text-xs">{profileForRecord(issue.authProfileId, issue.scanId)}</div>
        </>
      ),
    },
    {
      id: 'verified',
      header: 'Verified',
      accessor: (issue) => issue.lastResolution?.at || issue.lastVerifiedAt,
      render: (issue) => (
        <>
          <Status value="verified_resolved" />
          <div className="muted mt-1 text-xs">{date(issue.lastResolution?.at || issue.lastVerifiedAt)}</div>
        </>
      ),
    },
    {
      id: 'http',
      header: 'HTTP',
      accessor: (issue) => issue.lastResolution?.httpStatus ?? issue.latestHttpStatus,
      render: (issue) => issue.lastResolution?.httpStatus ?? issue.latestHttpStatus ?? '—',
    },
    {
      id: 'evidence',
      header: 'Evidence',
      sortable: false,
      render: (issue) => (
        <div className="flex flex-wrap gap-2">
          <Tooltip text="Open the original failure evidence">
            <ActionButton
              size="small"
              aria-label={`Original evidence for ${issue.url}`}
              onClick={() => void openHistoricalEvidence(issue.pageId)}
            >
              <Eye size={14} /> Original
            </ActionButton>
          </Tooltip>
          {issue.lastResolution?.pageId && (
            <Tooltip text="Open the successful verification evidence">
              <ActionButton
                size="small"
                aria-label={`Verified evidence for ${issue.url}`}
                onClick={() => void openHistoricalEvidence(issue.lastResolution!.pageId)}
              >
                <CheckCircle2 size={14} /> Verified
              </ActionButton>
            </Tooltip>
          )}
        </div>
      ),
    },
  ];
  // Routes use server-filtered, server-counted pages; the 500-row dashboard cache is not authoritative.
  const routeRows = routeResult?.items || [];
  const failedPageRows = pages.filter(
    (page) =>
      page.classification === 'failed' &&
      page.scanId === resultScan &&
      (!resultSite || page.siteId === resultSite) &&
      (resultProfile === '*' || (page.authProfileId || '') === resultProfile) &&
      filtered(`${page.url} ${page.issues.map((issue) => issue.message).join(' ')}`),
  );
  const activeFindingRows = issues.filter(
    (issue) =>
      (findingTab === 'all' ||
        findingTab === 'grouped' ||
        findingSeverity(issue) === (findingTab === 'errors' ? 'error' : 'warning')) &&
      ['open', 'reopened'].includes(issue.status) &&
      filtered(`${issue.url} ${issue.category} ${issue.message}`) &&
      (!resultSite || issue.siteId === resultSite) &&
      (resultProfile === '*' || (issue.authProfileId || '') === resultProfile),
  );
  const routeColumns: TableColumn<Page>[] = [
    {
      id: 'page',
      header: 'Page',
      accessor: (page) => page.title || page.url,
      render: (page) => (
        <>
          <div className="max-w-[380px] truncate font-semibold">{page.title || page.url}</div>
          <div className="muted mt-1 max-w-[380px] truncate text-xs">{page.url}</div>
          <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-300">
            {profileForRecord(page.authProfileId, page.scanId)} · Scan {page.scanId.slice(-8)}
          </div>
        </>
      ),
    },
    {
      id: 'seen',
      header: 'Captured',
      accessor: (page) => page.capturedAt,
      render: (page) => date(page.capturedAt),
    },
    { id: 'status', header: 'HTTP', accessor: (page) => page.status, render: (page) => page.status ?? '—' },
    {
      id: 'result',
      header: 'Result',
      accessor: (page) => page.classification,
      render: (page) => <Status value={page.classification} />,
    },
    {
      id: 'time',
      header: 'Time',
      accessor: (page) => page.durationMs,
      render: (page) => `${page.durationMs} ms`,
    },
    {
      id: 'evidence',
      header: 'Evidence',
      sortable: false,
      render: (page) => (
        <div className="flex flex-wrap gap-2">
          <ActionButton size="small" onClick={() => void viewPage(page)}>
            <Eye size={14} /> Details
          </ActionButton>
          <IconButton tooltip={`Retry ${page.url}`} onClick={() => void retry(page)}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
      ),
    },
  ];
  const failedPageColumns: TableColumn<Page>[] = [
    {
      id: 'issue',
      header: 'Issue',
      accessor: (page) => page.issues.map((issue) => issue.message).join('; '),
      render: (page) => (
        <>
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label={`Select page ${page.url}`}
              checked={selectedFailedPages.includes(page._id)}
              onChange={(event) =>
                setSelectedFailedPages((previous) =>
                  event.target.checked
                    ? [...new Set([...previous, page._id])]
                    : previous.filter((id) => id !== page._id),
                )
              }
            />
            Select page
          </label>
          <div className="font-semibold">
            {page.issues.map((issue) => issue.message).join('; ') || 'Page failed'}
          </div>
          <div className="muted max-w-96 truncate text-xs">{page.url}</div>
        </>
      ),
    },
    {
      id: 'website',
      header: 'Website',
      accessor: (page) => name(page.siteId),
      render: (page) => name(page.siteId),
    },
    { id: 'http', header: 'HTTP', accessor: (page) => page.status, render: (page) => page.status ?? '—' },
    {
      id: 'result',
      header: 'Status',
      accessor: (page) => page.classification,
      render: (page) => <Status value={page.classification} />,
    },
    {
      id: 'seen',
      header: 'Last seen',
      accessor: (page) => new Date(page.capturedAt),
      render: (page) => <span className="text-xs">{date(page.capturedAt)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      sortable: false,
      render: (page) => (
        <div className="flex gap-2">
          <ActionButton size="small" onClick={() => void viewPage(page)}>
            <Eye size={14} /> Details
          </ActionButton>
          <ActionButton size="small" onClick={() => void retry(page)}>
            <RefreshCw size={14} /> Retry
          </ActionButton>
        </div>
      ),
    },
  ];
  const activeFindingColumns: TableColumn<Issue>[] = [
    {
      id: 'issue',
      header: 'Issue',
      accessor: (issue) => issue.message,
      render: (issue) => (
        <>
          <label className="mb-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label={`Select finding ${issue.url}`}
              checked={selectedIssues.includes(issue._id)}
              onChange={(event) =>
                setSelectedIssues((previous) =>
                  event.target.checked
                    ? [...new Set([...previous, issue._id])]
                    : previous.filter((id) => id !== issue._id),
                )
              }
            />
            Select finding
          </label>
          <div className="max-w-96 truncate font-semibold">{issue.message}</div>
          <div className="muted max-w-96 truncate text-xs">{issue.url}</div>
          <div className="muted mt-1 text-xs">
            {findingSeverity(issue)} · {issue.category} · {issue.occurrences} occurrence(s) ·{' '}
            {profileForRecord(issue.authProfileId, issue.scanId)}
          </div>
        </>
      ),
    },
    {
      id: 'website',
      header: 'Website',
      accessor: (issue) => name(issue.siteId),
      render: (issue) => name(issue.siteId),
    },
    {
      id: 'http',
      header: 'HTTP',
      accessor: (issue) => issue.latestHttpStatus,
      render: (issue) => issue.latestHttpStatus ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (issue) => issue.status,
      render: (issue) => <Status value={issue.status} />,
    },
    {
      id: 'seen',
      header: 'Last seen',
      accessor: (issue) => new Date(issue.lastDetectedAt),
      render: (issue) => <span className="text-xs">{date(issue.lastDetectedAt)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      sortable: false,
      render: (issue) => (
        <div className="flex gap-2">
          <IconButton
            tooltip={`Inspect ${issue.url}`}
            onClick={() => {
              const page = pages.find((record) => record._id === issue.pageId);
              if (page) void viewPage(page);
              else setError('Historical page detail is outside the currently loaded page limit.');
            }}
          >
            <Eye size={14} />
          </IconButton>
          <IconButton
            tooltip={`Retry finding ${issue.url}`}
            onClick={() =>
              void invoke(() => api('scans/retry', 'POST', { pageId: issue.pageId }), 'Verification queued')
            }
          >
            <RefreshCw size={14} />
          </IconButton>
          <IconButton
            tooltip={`Move ${issue.url} to Manual Review`}
            onClick={() => {
              setSelectedIssues([issue._id]);
              setBulkReviewOpen(true);
            }}
          >
            <Clock4 size={14} />
          </IconButton>
        </div>
      ),
    },
  ];
  const title = nav.find((v) => v.id === section)?.name || 'Dashboard';
  return (
    <div className="auditor-shell flex min-h-screen">
      {mobile && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobile(false)}
        />
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
              {v.id === 'errors' && (summary?.issues ?? 0) > 0 && (
                <span
                  className="ml-auto flex gap-1"
                  title="Active finding records across all scans (not failed-page counts)"
                >
                  {(summary?.errorIssues ?? 0) > 0 && (
                    <span
                      aria-label="Active errors"
                      className="rounded-md bg-[#ffe2e3] px-2 text-xs text-[#b32838]"
                    >
                      {summary?.errorIssues}
                    </span>
                  )}
                  {(summary?.warningIssues ?? 0) > 0 && (
                    <span
                      aria-label="Active warnings"
                      className="rounded-md bg-amber-100 px-2 text-xs text-amber-800"
                    >
                      {summary?.warningIssues}
                    </span>
                  )}
                </span>
              )}
              {v.id === 'resolved' && (summary?.resolved ?? 0) > 0 && (
                <span className="ml-auto rounded-md bg-emerald-100 px-2 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  {summary?.resolved ?? 0}
                </span>
              )}
              {v.id === 'manual-review' && (summary?.manualReview ?? 0) > 0 && (
                <span className="ml-auto rounded-md bg-amber-100 px-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {summary?.manualReview ?? 0}
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
          <IconButton tooltip="Open navigation menu" onClick={() => setMobile(true)} className="lg:hidden">
            <Menu size={22} />
          </IconButton>
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
          <IconButton tooltip="Refresh dashboard data" onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </IconButton>
          <IconButton tooltip="Toggle light and dark theme" onClick={toggleTheme}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton
            tooltip="Sign out of Website Auditor"
            onClick={() =>
              setConfirmation({
                title: 'Sign out?',
                description: 'End your Website Auditor session? This does not sign out of audited websites.',
                confirmLabel: 'Sign out',
                onConfirm: () => void signOut(),
              })
            }
          >
            <LogOut size={16} />
          </IconButton>
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
                <ActionButton variant="primary" onClick={openNewSite}>
                  <Plus size={16} /> Add website
                </ActionButton>
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
              <IconButton tooltip="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {syncWarning && (
            <div
              role="status"
              className="rounded-lg border border-amber-300/50 bg-amber-100/50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
            >
              {syncWarning}
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="flex justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-200"
            >
              {notice}
              <IconButton tooltip="Dismiss notification" onClick={() => setNotice('')}>
                <X size={16} />
              </IconButton>
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
              <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <h2 className="section-h">Review and investigation</h2>
                  <p className="muted mt-1 text-xs">
                    Detailed scans, errors, and review decisions have dedicated workspaces.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="btn" href="/scans">
                    Scan history
                  </Link>
                  <Link className="btn" href="/errors">
                    Active findings
                  </Link>
                  <Link className="btn" href="/manual-review">
                    Manual Review
                  </Link>
                </div>
              </div>
              <OverviewKpis totals={summary} />
              <OverviewAnalytics sites={sites} pages={pages} scans={scans} asOf={updatedAt} />
            </>
          )}
          {section === 'websites' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="muted text-xs">{sites.length} registered environments</div>
                <ConfigBackupPanel sites={sites} onImported={refresh} />
              </div>
              <WebsiteGrid
                sites={sites}
                busy={Boolean(pending)}
                onConfigure={(site) => {
                  const options = profiles.filter((profile) => profile.siteId === site._id);
                  setSelectedSite(site._id);
                  setSelectedProfile(options.length === 1 ? options[0]._id : '');
                  router.push(`/scans?site=${encodeURIComponent(site._id)}`);
                }}
                onProfiles={(site) => newProfile(site._id)}
                onEdit={(site) => editSite(site)}
                onDelete={(site) => {
                  setDeleteSite(site);
                  setDeleteConfirmation('');
                  setDeleteHistory(false);
                }}
              />
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
                <ActionButton
                  variant="primary"
                  className="sm:ml-auto sm:self-end"
                  disabled={!selectedSite || !!pending || active(selectedSite, selectedProfile)}
                  onClick={() => void start(selectedSite, selectedProfile || undefined)}
                >
                  {pending === 'start' ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}{' '}
                  {active(selectedSite, selectedProfile) ? 'Scan already active' : 'Start scan'}
                </ActionButton>
                {selectedSite && (
                  <InlineAlert tone="info" className="w-full">
                    <strong>{selectedProfile ? 'Authenticated scan' : 'Public scan'}</strong>
                    <span className="ml-2 break-all">
                      {selectedProfile
                        ? `Login will be verified before crawling · ${profiles.find((profile) => profile._id === selectedProfile)?.startUrl || sites.find((site) => site._id === selectedSite)?.baseUrl || ''}`
                        : 'Only publicly accessible routes will be discovered. No credentials will be submitted.'}
                    </span>
                  </InlineAlert>
                )}
              </div>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Scan history filters">
                <TabBar
                  label="Scan status"
                  value={scanTab}
                  onChange={(value) => setScanTab(value as typeof scanTab)}
                  tabs={scanTabs.map((tab) => ({ value: tab.key, label: tab.label, count: tab.count }))}
                />
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
                    {filteredScans.map((sc, scanIndex) => (
                      <Fragment key={sc._id}>
                        {sc.batchId &&
                          filteredScans.findIndex((item) => item.batchId === sc.batchId) === scanIndex && (
                            <tr className="batch-parent">
                              <td colSpan={5}>
                                <button
                                  className="flex w-full items-center justify-between gap-3 text-left"
                                  type="button"
                                  aria-expanded={expandedBatches.includes(sc.batchId)}
                                  onClick={() => toggleBatch(sc.batchId!)}
                                >
                                  <span className="font-semibold">
                                    Batch {sc.batchId.slice(-8)} ·{' '}
                                    {(() => {
                                      const related = batches.find((b) => b._id === sc.batchId);
                                      return related && related.websites.length > 1
                                        ? `${related.websites.length} websites`
                                        : name(sc.siteId);
                                    })()}
                                  </span>
                                  {(() => {
                                    const total = batches.find((b) => b._id === sc.batchId);
                                    const loaded = filteredScans.filter(
                                      (item) => item.batchId === sc.batchId,
                                    ).length;
                                    if (!total)
                                      return (
                                        <span className="text-xs">
                                          {loaded} loaded job(s) · refresh for complete totals
                                        </span>
                                      );
                                    const progress = batchCompletion(total);
                                    return (
                                      <span className="text-xs" aria-label="Server-verified batch job counts">
                                        {total.attemptCounts
                                          ? `${total.attemptCounts.selected} selected · ${total.attemptCounts.newJobs} new · ${total.attemptCounts.reused} reused · ${total.attemptCounts.ineligible} ineligible · ${total.attemptCounts.rejected} rejected · `
                                          : ''}
                                        {total.jobs} actual jobs · {progress.done} finished ·{' '}
                                        {progress.active} active · {total.failed} failed · {total.cancelled}{' '}
                                        cancelled
                                        {loaded < total.jobs && ` · ${loaded} shown (recent history)`} ·{' '}
                                        {expandedBatches.includes(sc.batchId!) ? 'Collapse' : 'Expand'}
                                      </span>
                                    );
                                  })()}
                                </button>
                              </td>
                            </tr>
                          )}
                        {sc.batchId &&
                          expandedBatches.includes(sc.batchId) &&
                          filteredScans.findIndex((item) => item.batchId === sc.batchId) === scanIndex &&
                          (batchPages[sc.batchId]?.nextSkip !== null || batchLoading === sc.batchId) && (
                            <tr className="batch-child">
                              <td colSpan={5}>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={Boolean(batchLoading)}
                                  onClick={() => void fetchBatchPage(sc.batchId!)}
                                >
                                  {batchLoading === sc.batchId
                                    ? 'Loading batch jobs…'
                                    : `Load more jobs (${batchPages[sc.batchId]?.items.length ?? 0} fetched)`}
                                </button>
                              </td>
                            </tr>
                          )}
                        <tr
                          className={sc.batchId ? 'batch-child' : undefined}
                          hidden={
                            Boolean(sc.batchId && !expandedBatches.includes(sc.batchId)) &&
                            scanTab !== 'running' &&
                            scanTab !== 'failed' &&
                            scanTab !== 'completed'
                          }
                        >
                          <td>
                            <strong>{name(sc.siteId)}</strong>
                            <div className="muted mt-1 text-xs">Queued: {date(sc.createdAt)}</div>
                            {sc.startedAt && (
                              <div className="muted mt-1 text-[11px]">Started: {date(sc.startedAt)}</div>
                            )}
                            {sc.endedAt && (
                              <div className="muted mt-1 text-[11px]">Ended: {date(sc.endedAt)}</div>
                            )}
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
                            {sc.rerunOfScanId && (
                              <div className="muted mt-1 text-[11px]">
                                Rerun of scan {sc.rerunOfScanId.slice(-8)}
                              </div>
                            )}
                            {sc.error && <div className="mt-1 max-w-72 text-xs text-red-600">{sc.error}</div>}
                          </td>
                          <td>
                            <Status value={sc.status} />
                          </td>
                          <td className="min-w-52">
                            <div className="mb-2 text-xs">
                              {sc.progress.visited} visited / {sc.progress.discovered} discovered{' '}
                              {sc.progress.skipped ? `· ${sc.progress.skipped} skipped ` : ''}
                              <span className="muted">· {sc.phase || sc.status}</span>
                            </div>
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${Math.min(100, (100 * (sc.progress.visited + (sc.progress.skipped || 0))) / Math.max(1, sc.progress.discovered))}%`,
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
                                <IconButton
                                  disabled={!!pending}
                                  tooltip="Pause scan"
                                  onClick={() => void action(sc._id, 'pause')}
                                >
                                  <Pause size={14} />
                                </IconButton>
                              )}
                              {sc.status === 'paused' && (
                                <IconButton
                                  disabled={!!pending}
                                  tooltip="Resume scan"
                                  onClick={() => void action(sc._id, 'resume')}
                                >
                                  <Play size={14} />
                                </IconButton>
                              )}
                              {['running', 'paused', 'queued'].includes(sc.status) && (
                                <IconButton
                                  variant="danger-outline"
                                  disabled={!!pending}
                                  tooltip={
                                    sc.status === 'queued'
                                      ? 'Cancel queued scan immediately'
                                      : 'Request cancellation after active page'
                                  }
                                  onClick={() => setCancelScanId(sc._id)}
                                >
                                  {pending === `action-${sc._id}` ? (
                                    <LoaderCircle size={13} className="animate-spin" />
                                  ) : (
                                    <Square size={13} />
                                  )}
                                </IconButton>
                              )}
                              <IconButton
                                tooltip="Show only this scan's routes"
                                onClick={() =>
                                  router.push(
                                    `/routes?site=${encodeURIComponent(sc.siteId)}&scan=${encodeURIComponent(sc._id)}`,
                                  )
                                }
                              >
                                <RouteIcon size={14} />
                              </IconButton>
                              <IconButton
                                tooltip="Show only this scan's errors"
                                onClick={() =>
                                  router.push(
                                    `/errors?site=${encodeURIComponent(sc.siteId)}&scan=${encodeURIComponent(sc._id)}`,
                                  )
                                }
                              >
                                <AlertTriangle size={14} />
                              </IconButton>
                              <IconButton
                                tooltip="View scan activity"
                                onClick={() => {
                                  setScanEvents([]);
                                  setLiveScan(liveScan === sc._id ? '' : sc._id);
                                }}
                              >
                                <Terminal size={14} />
                              </IconButton>
                              {!['queued', 'running', 'paused'].includes(sc.status) && (
                                <Tooltip text="Rerun with the original website, profile and scan options">
                                  <ActionButton
                                    aria-label={`Rerun scan ${sc._id}`}
                                    size="small"
                                    disabled={!!pending}
                                    onClick={() => {
                                      setRerunOptions(sc.options || {});
                                      setRerunScanId(sc._id);
                                    }}
                                  >
                                    <RotateCcw size={14} /> Rerun
                                  </ActionButton>
                                </Tooltip>
                              )}
                              {sc.reportKeys && (
                                <a
                                  className="btn"
                                  aria-label={`Download HTML report for ${sc._id}`}
                                  title="Download HTML report"
                                  href={`/api/report/${sc._id}?format=html`}
                                >
                                  <Download size={14} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {!filteredScans.length && <Empty message="No scans match the selected filters." />}
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
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setRoutePage(0);
                  }}
                />
                <select
                  aria-label="Filter results by website"
                  className="input max-w-48"
                  value={resultSite}
                  onChange={(e) => {
                    setResultSite(e.target.value);
                    setRoutePage(0);
                    setResultScan('');
                    setSelectedIssues([]);
                    setSelectedFailedPages([]);
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
                  onChange={(e) => {
                    setResultProfile(e.target.value);
                    setRoutePage(0);
                    setSelectedIssues([]);
                    setSelectedFailedPages([]);
                  }}
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
                  onChange={(e) => {
                    setResultScan(e.target.value);
                    setRoutePage(0);
                    setSelectedIssues([]);
                    setSelectedFailedPages([]);
                  }}
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
              {section === 'routes' && (
                <TabBar
                  label="Route status"
                  value={routeTab}
                  onChange={(value) => {
                    const next = value as typeof routeTab;
                    setRouteTab(next);
                    setRoutePage(0);
                    const url = new URL(window.location.href);
                    if (next === 'all') url.searchParams.delete('status');
                    else url.searchParams.set('status', next);
                    window.history.replaceState(null, '', url.pathname + url.search);
                  }}
                  tabs={[
                    { value: 'all', label: 'All', count: routeResult?.counts.all ?? 0 },
                    { value: 'successful', label: 'Successful', count: routeResult?.counts.successful ?? 0 },
                    { value: 'warnings', label: 'Warnings', count: routeResult?.counts.warnings ?? 0 },
                    { value: 'failed', label: 'Failed', count: routeResult?.counts.failed ?? 0 },
                    { value: 'resolved', label: 'Resolved', count: routeResult?.counts.resolved ?? 0 },
                  ]}
                />
              )}
              {section === 'errors' && !resultScan && (
                <TabBar
                  label="Active finding categories"
                  value={findingTab}
                  onChange={(value) => {
                    setFindingTab(value as typeof findingTab);
                    setSelectedIssues([]);
                  }}
                  tabs={[
                    { value: 'all', label: 'All active', count: findingCounts?.all ?? summary?.issues ?? 0 },
                    {
                      value: 'errors',
                      label: 'Errors',
                      count: findingCounts?.errors ?? summary?.errorIssues ?? 0,
                    },
                    {
                      value: 'warnings',
                      label: 'Warnings',
                      count: findingCounts?.warnings ?? summary?.warningIssues ?? 0,
                    },
                    {
                      value: 'grouped',
                      label: 'Detected issue groups',
                      count: findingCounts?.groups ?? groupActiveFindings(activeFindingRows).length,
                    },
                  ]}
                />
              )}
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
              {section === 'errors' && !!resultScan && (
                <div className="surface mb-4 flex flex-wrap items-center gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label="Select all failed pages in this scan"
                      checked={
                        eligibleFailedPages.length > 0 &&
                        eligibleFailedPages.every((page) => selectedFailedPages.includes(page._id))
                      }
                      onChange={(e) =>
                        setSelectedFailedPages(
                          e.target.checked ? eligibleFailedPages.map((page) => page._id) : [],
                        )
                      }
                    />
                    Select all failed pages ({eligibleFailedPages.length})
                  </label>
                  <span className="muted text-sm">{selectedFailedPages.length} selected</span>
                  <ActionButton
                    disabled={!effectiveSelectedPages.length || !!pending}
                    onClick={() => setBulkRetryOpen(true)}
                  >
                    Retry selected pages
                  </ActionButton>
                </div>
              )}
              {section === 'errors' && !resultScan && (
                <div className="surface mb-4 flex flex-wrap items-center gap-3 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      aria-label="Select all eligible findings"
                      type="checkbox"
                      checked={
                        eligibleIssues.length > 0 &&
                        eligibleIssues.every((i) => selectedIssues.includes(i._id))
                      }
                      onChange={(e) =>
                        setSelectedIssues(e.target.checked ? eligibleIssues.map((i) => i._id) : [])
                      }
                    />
                    Select all eligible ({eligibleIssues.length})
                  </label>
                  <span className="muted text-sm">{selectedIssues.length} selected</span>
                  <ActionButton
                    disabled={!effectiveSelectedIssues.length || !!pending}
                    onClick={() => {
                      setRetryAllSiteIssues(false);
                      setBulkRetryOpen(true);
                    }}
                  >
                    <RefreshCw size={14} /> Retry selected
                  </ActionButton>
                  <ActionButton
                    disabled={!eligibleIssues.length || !!pending}
                    onClick={() => {
                      setSelectedIssues(eligibleIssues.map((i) => i._id));
                      setRetryAllSiteIssues(Boolean(resultSite && !resultScan));
                      setBulkRetryOpen(true);
                    }}
                  >
                    {resultSite ? 'Retry all eligible for website' : 'Retry all displayed eligible'}
                  </ActionButton>
                  <ActionButton
                    disabled={!effectiveSelectedIssues.length || !!pending}
                    onClick={() => setBulkReviewOpen(true)}
                  >
                    <Clock4 size={14} /> Move to Manual Review
                  </ActionButton>
                </div>
              )}
              {section === 'routes' ? (
                <div className="space-y-3">
                  <DataTable
                    rows={routeRows}
                    columns={routeColumns}
                    rowKey={(page) => page._id}
                    caption="Discovered routes"
                    sortState={routeSort}
                    onSortChange={(sort) => {
                      setRouteSort(sort);
                      setRoutePage(0);
                    }}
                    emptyMessage="No routes match these filters. Run a scan to populate diagnostics."
                  />
                  <div className="surface flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <span className="muted">
                      {routeResult?.total ?? 0} matching routes · Page {routePage + 1} of{' '}
                      {Math.max(1, Math.ceil((routeResult?.total ?? 0) / 50))}
                    </span>
                    <div className="flex gap-2">
                      <ActionButton
                        disabled={routePage === 0}
                        size="small"
                        onClick={() => setRoutePage((current) => Math.max(0, current - 1))}
                      >
                        Previous
                      </ActionButton>
                      <ActionButton
                        disabled={(routePage + 1) * 50 >= (routeResult?.total ?? 0)}
                        size="small"
                        onClick={() => setRoutePage((current) => current + 1)}
                      >
                        Next
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ) : resultScan ? (
                <DataTable
                  rows={failedPageRows}
                  columns={failedPageColumns}
                  rowKey={(page) => page._id}
                  caption="Failed pages in selected scan"
                  initialSort="seen"
                  initialDirection="desc"
                  emptyMessage="No failed pages match these filters."
                />
              ) : findingTab === 'grouped' ? (
                <FindingGroups
                  groups={groupActiveFindings(activeFindingRows)}
                  findings={activeFindingRows}
                  selectedIds={selectedIssues}
                  onSelectionChange={setSelectedIssues}
                  onInspect={(issue) => {
                    const page = pages.find((record) => record._id === issue.pageId);
                    if (page) void viewPage(page);
                    else setError('Historical page detail is outside the currently loaded page limit.');
                  }}
                />
              ) : (
                <DataTable
                  rows={activeFindingRows}
                  columns={activeFindingColumns}
                  rowKey={(issue) => issue._id}
                  caption="Active findings"
                  initialSort="seen"
                  initialDirection="desc"
                  emptyMessage="No active findings match these filters."
                />
              )}
            </>
          )}
          {section === 'resolved' && (
            <>
              <section className="surface space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="section-h">Verified Resolved Findings</h2>
                    <p className="muted mt-1 text-xs">
                      Only independently passed verification scans move findings here. Original errors and
                      evidence remain unchanged.
                    </p>
                  </div>
                  <span className="pill passed">{summary?.resolved ?? 0} verified resolved</span>
                </div>
              </section>
              <section className="surface space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <label className="flex min-w-52 flex-1 items-center gap-2">
                    <Search size={16} className="muted" />
                    <input
                      className="input w-full"
                      aria-label="Search resolved findings"
                      placeholder="Search route, category or message"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter resolved findings by website"
                    className="input"
                    value={resultSite}
                    onChange={(event) => setResultSite(event.target.value)}
                  >
                    <option value="">All websites</option>
                    {sites.map((site) => (
                      <option key={site._id} value={site._id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter resolved findings by profile"
                    className="input"
                    value={resultProfile}
                    onChange={(event) => setResultProfile(event.target.value)}
                  >
                    <option value="*">All profiles</option>
                    <option value="">Unauthenticated</option>
                    {profiles.map((profile) => (
                      <option key={profile._id} value={profile._id}>
                        {profile.name} · {name(profile.siteId)}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
              <DataTable
                rows={resolvedMatches}
                columns={resolvedColumns}
                rowKey={(issue) => issue._id}
                initialSort="verified"
                initialDirection="desc"
                caption="Verified resolved findings"
                emptyMessage="No verified resolutions match these filters. Successful retries appear here automatically."
              />
            </>
          )}
          {section === 'manual-review' && (
            <ManualReviewPanel findings={reviewFindings} siteName={name} onChanged={refresh} />
          )}
          {section === 'workers' && <WorkerManager />}
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
      <ConfirmDialog
        open={Boolean(cancelScanId)}
        title="Cancel this scan?"
        danger
        description="Queued work will be cancelled immediately. Running scans will stop after the current operation when possible. All pages and evidence already recorded remain preserved."
        confirmLabel="Confirm cancellation"
        busy={Boolean(pending)}
        onClose={() => setCancelScanId('')}
        onConfirm={() => {
          const target = cancelScanId;
          setCancelScanId('');
          void action(target, 'cancel');
        }}
      />
      <ConfirmDialog
        open={Boolean(profileToArchive)}
        title="Archive authentication profile?"
        danger
        description={`Archive ${profileToArchive?.name || 'this profile'} and prevent future scans from using it. Historical scans, results and credentials remain preserved. Active scans must finish first.`}
        confirmLabel="Archive profile"
        busy={pending === 'archive-profile'}
        onClose={() => setProfileToArchive(null)}
        onConfirm={() => {
          if (profileToArchive) void archiveProfile(profileToArchive);
        }}
      />
      <ConfirmDialog
        open={Boolean(profileToRestore)}
        title="Restore authentication profile?"
        description={`Restore ${profileToRestore?.name || 'this profile'} for new scans. Existing history remains unchanged.`}
        confirmLabel="Restore profile"
        busy={pending === 'restore-profile'}
        onClose={() => setProfileToRestore(null)}
        onConfirm={() => {
          if (profileToRestore) void restoreProfile(profileToRestore);
        }}
      />
      <Dialog
        open={Boolean(rerunScanId)}
        title="Configure scan rerun"
        onClose={() => setRerunScanId('')}
        footer={
          <>
            <ActionButton onClick={() => setRerunScanId('')} disabled={pending === 'rerun'}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              loading={pending === 'rerun'}
              onClick={() => {
                const original = rerunScanId;
                setRerunScanId('');
                void rerunScan(original);
              }}
            >
              Create separate rerun
            </ActionButton>
          </>
        }
      >
        <p className="text-sm">
          The original website, authentication profile, crawl scope and scan mode are reused. Adjust optional
          numeric limits below, or leave them blank to inherit the original settings. Original evidence and
          reports are preserved.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(
            [
              { key: 'maxPages', label: 'Max pages (0 = Auto)', min: 0, max: 10000 },
              { key: 'maxDepth', label: 'Crawl depth', min: 0, max: 10 },
              { key: 'concurrency', label: 'Browser concurrency', min: 1, max: 6 },
              { key: 'timeoutMs', label: 'Request timeout (ms)', min: 3000, max: 120000 },
            ] as const
          ).map((field) => (
            <label key={field.key} className="block">
              <span className="field-label">{field.label}</span>
              <input
                className="input"
                type="number"
                min={field.min}
                max={field.max}
                value={rerunOptions[field.key] ?? ''}
                placeholder="Use original"
                onChange={(event) => {
                  const value = event.target.value;
                  setRerunOptions((previous) => {
                    const next = { ...previous };
                    if (!value) delete next[field.key];
                    else next[field.key] = Number(value);
                    return next;
                  });
                }}
              />
            </label>
          ))}
        </div>
      </Dialog>
      <ConfirmDialog
        open={bulkRetryOpen}
        title="Retry selected findings?"
        description={
          retryAllSiteIssues
            ? 'Queue verification for ALL eligible active findings on the selected website in bounded batches. Original findings and history remain unchanged.'
            : `Queue verification of ${resultScan ? effectiveSelectedPages.length : effectiveSelectedIssues.length} selected failure(s). Previous results remain unchanged, and duplicate active retries will be reused.`
        }
        confirmLabel="Queue verification"
        busy={pending === 'bulk-retry'}
        onClose={() => setBulkRetryOpen(false)}
        onConfirm={() => void bulkRetryIssues()}
      />
      <Dialog
        open={bulkReviewOpen}
        title="Move findings to Manual Review"
        onClose={() => setBulkReviewOpen(false)}
        footer={
          <>
            <ActionButton onClick={() => setBulkReviewOpen(false)}>Cancel</ActionButton>
            <ActionButton
              variant="primary"
              loading={pending === 'bulk-review'}
              onClick={() => void bulkMoveToReview()}
            >
              Confirm moving {effectiveSelectedIssues.length}
            </ActionButton>
          </>
        }
      >
        <p className="text-sm">
          Move selected findings out of Active Errors without deleting their original scan evidence. An audit
          event will be appended for each finding.
        </p>
        <label className="mt-3 block">
          <span className="field-label">Review reason / comment (optional)</span>
          <textarea
            className="input min-h-24"
            maxLength={2000}
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
          />
        </label>
      </Dialog>
      <Dialog
        title={editingSite ? 'Edit website' : 'Register a website'}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        dirty={siteDirty}
        footer={
          <>
            <ActionButton
              onClick={() => {
                if (!siteDirty) setShowAdd(false);
                else
                  setConfirmation({
                    title: 'Discard website changes?',
                    description: 'Your unsaved website settings will be lost.',
                    confirmLabel: 'Discard changes',
                    danger: true,
                    onConfirm: () => setShowAdd(false),
                  });
              }}
              disabled={Boolean(pending)}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              type="submit"
              form="website-editor-form"
              disabled={Boolean(pending)}
              loading={pending === 'action'}
            >
              {editingSite ? 'Update website' : 'Save website'}
            </ActionButton>
          </>
        }
      >
        <form id="website-editor-form" onSubmit={addSite} className="space-y-4">
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
              authentication profile for each login and, if necessary, a separate website entry per origin. A
              login URL never silently expands the crawl scope.
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
                Auto scans up to AUTO_PAGE_SAFETY_LIMIT (default 10,000), within crawl depth and time budget.
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
              Browser-faithful mode allows same-origin Livewire component requests initiated by the page, even
              when their payload includes updates or methods. The auditor does not click submit/save/delete
              controls, but page-generated requests can still mutate data. Only use with authorized
              non-production test accounts and disposable data. Passive mode retains stricter filtering. The
              two modes are optional; strict blocking remains the default.
            </p>
          )}
          <label className="line flex items-start gap-2 border-t pt-4 text-xs">
            <input
              type="checkbox"
              required
              checked={siteForm.authorized}
              onChange={(e) => setSiteForm({ ...siteForm, authorized: e.target.checked })}
            />
            <span>I own or have explicit permission to audit this site and its configured target scope.</span>
          </label>
        </form>
      </Dialog>
      <Dialog
        title="Delete website"
        size="small"
        open={Boolean(deleteSite)}
        danger
        onClose={() => setDeleteSite(null)}
        footer={
          <>
            <ActionButton disabled={Boolean(pending)} onClick={() => setDeleteSite(null)}>
              Cancel
            </ActionButton>
            <DestructiveButton
              emphasis="strong"
              disabled={Boolean(pending) || !deleteSite || deleteConfirmation !== deleteSite.name}
              onClick={() => void removeWebsite()}
            >
              Delete website
            </DestructiveButton>
          </>
        }
      >
        {deleteSite && (
          <div className="space-y-4">
            <InlineAlert tone="warning">
              Removing <strong>{deleteSite.name}</strong> also archives its authentication profiles. Active
              scans must finish first. Historical evidence is retained unless you explicitly choose deletion.
            </InlineAlert>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteHistory}
                onChange={(e) => setDeleteHistory(e.target.checked)}
              />
              Permanently delete historical scans, findings and RustFS evidence (optional)
            </label>
            <Field title={`Type ${deleteSite.name} to confirm`}>
              <input
                className="input"
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        title={editingProfile ? 'Edit profile' : 'Add profile'}
        open={showProfile}
        dirty={profileDirty}
        onClose={() => setShowProfile(false)}
        footer={
          <ActionButton
            variant="primary"
            type="submit"
            form="auditor-profile-form"
            loading={Boolean(pending)}
          >
            Save profile
          </ActionButton>
        }
      >
        <form id="auditor-profile-form" onSubmit={addProfile} className="space-y-4">
          {!!selectedSite && profiles.some((profile) => profile.siteId === selectedSite) && (
            <details className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--line)' }}>
              <summary className="cursor-pointer font-semibold">
                Existing profiles for this website (
                {profiles.filter((profile) => profile.siteId === selectedSite).length})
              </summary>
              <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
                {profiles
                  .filter((profile) => profile.siteId === selectedSite)
                  .map((profile) => (
                    <div className="flex items-center justify-between gap-2" key={profile._id}>
                      <div className="min-w-0 truncate">
                        <strong>{profile.name}</strong> · {profile.loginUrl}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <ActionButton onClick={() => editProfile(profile)}>Edit</ActionButton>
                        <DestructiveButton action="archive" onClick={() => setProfileToArchive(profile)}>
                          Archive
                        </DestructiveButton>
                      </div>
                    </div>
                  ))}
              </div>
            </details>
          )}
          {archivedProfiles.some((profile) => profile.siteId === (selectedSite || profileForm.siteId)) && (
            <details className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
              <summary className="cursor-pointer font-semibold">
                Archived profiles (preserved history)
              </summary>
              <div className="mt-2 space-y-2">
                {archivedProfiles
                  .filter((profile) => profile.siteId === (selectedSite || profileForm.siteId))
                  .map((profile) => (
                    <div className="flex items-center justify-between gap-2" key={profile._id}>
                      <span>{profile.name}</span>
                      <ActionButton size="small" onClick={() => setProfileToRestore(profile)}>
                        Restore
                      </ActionButton>
                    </div>
                  ))}
              </div>
            </details>
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
          <div
            className="rounded-lg border bg-[var(--hover)] p-3 text-sm"
            style={{ borderColor: 'var(--line)' }}
          >
            <span className="field-label">Associated website</span>
            <strong>
              {sites.find((site) => site._id === (selectedSite || profileForm.siteId))?.name || 'Website'}
            </strong>
            <p className="muted mt-1 text-xs">Profiles are permanently associated with this website.</p>
          </div>
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
        </form>
      </Dialog>
      {detail && (
        <SlideOver
          title="Page diagnostics"
          open={Boolean(detail)}
          onClose={() => setDetail(null)}
          description={
            <div className="space-y-1">
              <p className="break-all">{detail.url}</p>
              <p className="text-blue-600 dark:text-blue-300">
                {profileForRecord(detail.authProfileId, detail.scanId)} · Scan {detail.scanId.slice(-8)}
              </p>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Status value={detail.classification} />
              <span className="muted text-xs">
                HTTP {detail.status ?? '—'} · {detail.durationMs} ms
              </span>
              <ActionButton onClick={() => void retry(detail)}>
                <RefreshCw size={13} /> Retry
              </ActionButton>
              <a className="btn" href={detail.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> Open live
              </a>
              <ActionButton onClick={() => void navigator.clipboard.writeText(detail.url)}>
                <Copy size={13} /> Copy
              </ActionButton>
              <ActionButton onClick={() => void inspect(detail)}>
                <Search size={13} /> Investigate
              </ActionButton>
              <ActionButton onClick={() => void compare(detail)}>Before/after</ActionButton>
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
                <ActionButton disabled={!patch} onClick={() => void propose(detail)}>
                  Validate patch
                </ActionButton>
                {proposal && (
                  <div className="flex items-center gap-2">
                    <span className="muted text-xs">Proposed change ready for explicit approval.</span>
                    <ActionButton
                      variant="primary"
                      onClick={() =>
                        setConfirmation({
                          title: 'Apply reviewed patch?',
                          description:
                            'Apply this reviewed diff to the authorized local project? A restorable backup will be created.',
                          confirmLabel: 'Approve and apply',
                          danger: true,
                          onConfirm: () => void apply(),
                        })
                      }
                    >
                      Approve and apply
                    </ActionButton>
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
        </SlideOver>
      )}
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title || ''}
        description={confirmation?.description || ''}
        confirmLabel={confirmation?.confirmLabel || 'Confirm'}
        danger={confirmation?.danger}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(null);
          action?.();
        }}
      />
    </div>
  );
}
