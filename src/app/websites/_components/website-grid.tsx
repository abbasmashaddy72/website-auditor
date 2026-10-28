import WebsiteCard, { type WebsiteCardSite } from './website-card';
import { EmptyState } from '@/components/ui';

/** Website page owns the grid; the shared controller supplies data and actions. */
export function WebsiteGrid<Site extends WebsiteCardSite>({
  sites,
  busy,
  onConfigure,
  onProfiles,
  onEdit,
  onDelete,
}: {
  sites: Site[];
  busy: boolean;
  onConfigure: (site: Site) => void;
  onProfiles: (site: Site) => void;
  onEdit: (site: Site) => void;
  onDelete: (site: Site) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sites.map((site) => (
        <WebsiteCard
          key={site._id}
          site={site}
          busy={busy}
          onConfigure={() => onConfigure(site)}
          onProfiles={() => onProfiles(site)}
          onEdit={() => onEdit(site)}
          onDelete={() => onDelete(site)}
        />
      ))}
      {sites.length === 0 && (
        <div className="col-span-full">
          <EmptyState message="No websites yet. Register a site to begin monitoring." />
        </div>
      )}
    </div>
  );
}
