import type { PageTiming } from './performance';
import type { ReviewEvent, ReviewState } from './review';
import type { ObjectId } from 'mongodb';
export type ScanState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'completed_partial'
  | 'failed'
  | 'cancelled';
export type IssueStatus = 'open' | 'verified_resolved' | 'reopened' | 'manual_review';
export interface Site {
  _id?: ObjectId;
  name: string;
  baseUrl: string;
  environment: 'local' | 'staging' | 'production';
  framework?: string;
  sourcePath?: string;
  allowedHosts: string[];
  allowedPorts: number[];
  allowPrivateNetwork: boolean;
  allowLocalhost: boolean;
  ignoreHTTPSErrors: boolean;
  maxPages: number;
  /** Navigation-only is the safe default; all-links includes normal page content anchors. */
  discoveryMode?: 'navigation' | 'all-links';
  maxDepth: number;
  concurrency: number;
  timeoutMs: number;
  captureTraces?: boolean;
  captureHealthy?: boolean;
  /** Local/staging only, explicitly authorized normal Livewire background initialization. */
  allowPassiveLivewire?: boolean;
  /** Opt-in browser-faithful first-party Livewire traffic for authorized non-production test sites. */
  allowLivewireBackground?: boolean;
  scheduleMinutes?: number;
  nextAutoScanAt?: Date;
  authProfileIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
export interface AuthProfile {
  _id?: ObjectId;
  siteId: string;
  name: string;
  loginUrl: string;
  profileNameKey?: string;
  archivedAt?: Date;
  startUrl?: string;
  username: string;
  encryptedPassword: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successSelector?: string;
  successUrl?: string;
  createdAt: Date;
}
export interface Scan {
  _id?: ObjectId;
  siteId: string;
  authProfileId?: string;
  authProfileName?: string;
  authenticatedLandingUrl?: string;
  mode: 'crawl' | 'retry' | 'import';
  /** Immutable link to a previous scan when manually rerun. */
  rerunOfScanId?: string;
  /** Optional grouping key for multiple scan jobs submitted as a single operation. */
  batchId?: string;
  urls?: string[];
  options?: Partial<Pick<Site, 'maxPages' | 'maxDepth' | 'concurrency' | 'timeoutMs'>>;
  status: ScanState;
  classificationHistory?: Array<{
    at: Date;
    migration: string;
    previousStatus: ScanState;
    previousProgress: Scan['progress'];
    updatedStatus: ScanState;
  }>;
  activeKey?: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  progress: {
    discovered: number;
    visited: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped?: number;
    currentUrl?: string;
  };
  cancelRequested?: boolean;
  error?: string;
  reportKeys?: Record<string, string>;
  phase?: string;
  lastActivityAt?: Date;
}
export interface PageResult {
  _id?: ObjectId;
  scanId: string;
  siteId: string;
  authProfileId?: string;
  url: string;
  finalUrl: string;
  depth: number;
  status?: number;
  initialStatus?: number;
  redirects: Array<{ url: string; status: number }>;
  title: string;
  durationMs: number;
  classification: 'passed' | 'warning' | 'failed';
  classificationHistory?: Array<{
    at: Date;
    from: 'failed';
    to: 'warning';
    reason: string;
    migration: string;
  }>;
  issues: Array<{ category: string; message: string }>;
  warnings?: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; method: string; status?: number; failure?: string }>;
  evidence: Record<string, string>;
  capturedAt: Date;
  discoveredLinks?: string[];
  discoveredInteractions?: Array<{
    label: string;
    kind: 'modal' | 'drawer' | 'livewire-action';
    executed: false;
  }>;
  expectedAuthentication?: boolean;
  performance?: PageTiming;
}
export interface Issue {
  _id?: ObjectId;
  siteId: string;
  authProfileId?: string;
  url: string;
  fingerprint: string;
  category: string;
  message: string;
  status: IssueStatus;
  latestHttpStatus?: number;
  firstDetectedAt: Date;
  /** Immutable origin for findings created after this upgrade; older findings keep original history. */
  firstScanId?: string;
  firstPageId?: string;
  lastDetectedAt: Date;
  lastVerifiedAt?: Date;
  scanId: string;
  pageId: string;
  occurrences: number;
  history: Array<{ at: Date; scanId: string; pageId?: string; status?: number; classification: string }>;
  /** Last independently verified recovery. Original failing scan/page IDs are never replaced. */
  lastResolution?: { at: Date; scanId: string; pageId: string; httpStatus?: number };
  reviewState?: ReviewState;
  reviewHistory?: ReviewEvent[];
  reviewVersion?: number;
}

export interface WorkerInfo {
  _id: string;
  startedAt: Date;
  heartbeatAt: Date;
  status: 'ready' | 'initializing' | 'unhealthy' | 'stopping';
  currentScanId?: string;
  error?: string;
  pid?: number;
}
export interface ScanEvent {
  _id?: ObjectId;
  scanId: string;
  siteId: string;
  at: Date;
  level: 'info' | 'warning' | 'error';
  phase: string;
  message: string;
  url?: string;
  workerId?: string;
}
