import { ExternalLink, Globe2, Play, Settings, ShieldCheck } from 'lucide-react';
import { ActionButton, DestructiveButton, StatusBadge, Tooltip, Card } from '@/components/ui';
export type WebsiteCardSite = {
  _id: string;
  name: string;
  baseUrl: string;
  environment: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
};
export default function WebsiteCard({
  site,
  busy,
  onConfigure,
  onProfiles,
  onEdit,
  onDelete,
}: {
  site: WebsiteCardSite;
  busy?: boolean;
  onConfigure: () => void;
  onProfiles: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card as="article" className="website-card flex min-w-0 flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
          <Globe2 size={21} />
        </span>
        <StatusBadge status={site.environment} />
      </div>
      <h3 className="mt-4 font-semibold">{site.name}</h3>
      <a
        href={site.baseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="muted mt-1 flex min-w-0 items-center gap-1 text-xs break-all hover:underline"
      >
        {site.baseUrl}
        <ExternalLink size={13} className="shrink-0" />
      </a>
      <dl
        className="muted mt-4 grid grid-cols-3 gap-2 border-t pt-4 text-xs"
        style={{ borderColor: 'var(--line)' }}
      >
        <div>
          <dt>Pages limit</dt>
          <dd className="mt-1 font-semibold">{site.maxPages === 0 ? 'Auto' : site.maxPages}</dd>
        </div>
        <div>
          <dt>Depth</dt>
          <dd className="mt-1 font-semibold">{site.maxDepth}</dd>
        </div>
        <div>
          <dt>Concurrency</dt>
          <dd className="mt-1 font-semibold">{site.concurrency}</dd>
        </div>
      </dl>
      <div
        className="website-card__actions mt-auto grid min-w-0 grid-cols-4 items-stretch gap-1 pt-5"
        role="group"
        aria-label={`Actions for ${site.name}`}
      >
        <Tooltip text="Configure and start a new scan">
          <ActionButton variant="primary" disabled={busy} onClick={onConfigure}>
            <Play size={13} /> Scan
          </ActionButton>
        </Tooltip>
        <Tooltip text="Create or edit this website's authentication profiles">
          <ActionButton disabled={busy} onClick={onProfiles}>
            <ShieldCheck size={14} /> Profiles
          </ActionButton>
        </Tooltip>
        <Tooltip text="Edit website settings">
          <ActionButton disabled={busy} onClick={onEdit}>
            <Settings size={14} /> Edit
          </ActionButton>
        </Tooltip>
        <Tooltip text="Opens a confirmation; historical data is preserved by default">
          <DestructiveButton disabled={busy} onClick={onDelete}>
            Delete
          </DestructiveButton>
        </Tooltip>
      </div>
    </Card>
  );
}
