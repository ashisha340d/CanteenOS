import { useMemo, useState } from 'react';
import {
  YoutubeImportStatus,
  YOUTUBE_IMPORT_ACTIVE_STATUSES,
  type YoutubeImportDto,
} from '@menuboard/shared';
import { ChefHatIcon, ExternalLinkIcon, EyeIcon, RotateCwIcon, VideoIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SelectField, TextField } from '@/components/form/fields';
import { DeleteAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '../../components/Modal/Modal';
import { StatusChip } from '../../components/StatusChip';
import {
  useCreateYoutubeImport,
  useDeleteYoutubeImport,
  useRetryYoutubeImport,
  useYoutubeImports,
} from '../../hooks/useYoutubeImports';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { YoutubeImportDetailDialog } from './YoutubeImportDetailDialog';

function isActive(row: YoutubeImportDto): boolean {
  return YOUTUBE_IMPORT_ACTIVE_STATUSES.includes(row.status);
}

/**
 * Hotlinked straight from YouTube's own CDN — same as the detail dialog. Nothing here is
 * downloaded or written to the media library; the URL is only ever what yt-dlp reported.
 */
function VideoThumbnail({ row, className }: { row: YoutubeImportDto; className?: string }): JSX.Element {
  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground flex items-center justify-center overflow-hidden rounded-md border',
        className,
      )}
    >
      {row.thumbnailUrl ? (
        <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <VideoIcon className="size-4 opacity-50" />
      )}
    </div>
  );
}

/**
 * YouTube Recipe Downloader — the staging list. Submitting a URL returns immediately; the
 * backend processes the video in the background and this list polls while anything is still
 * moving. Review/save happens through the existing recipe editor; nothing here writes to the
 * Recipe Master directly.
 */
export function YoutubeImportsPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<YoutubeImportStatus | ''>('');
  const [view, setView] = useViewMode('youtube-imports');
  const [importOpen, setImportOpen] = useState(false);
  const [viewing, setViewing] = useState<YoutubeImportDto | null>(null);
  const [deleting, setDeleting] = useState<YoutubeImportDto | null>(null);

  const query = useMemo(() => (status ? { status } : {}), [status]);
  const { data: allRows = [], isLoading } = useYoutubeImports(query);
  const retry = useRetryYoutubeImport();
  const del = useDeleteYoutubeImport();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) =>
        (r.videoTitle ?? '').toLowerCase().includes(q) ||
        (r.channelName ?? '').toLowerCase().includes(q) ||
        r.youtubeUrl.toLowerCase().includes(q),
    );
  }, [allRows, search]);
  const filtersActive = Boolean(status) || search.trim() !== '';

  async function onRetry(row: YoutubeImportDto): Promise<void> {
    try {
      await retry.mutateAsync(row.id);
      notify.success('Import re-queued.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Import deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  const columns: DataTableColumn<YoutubeImportDto>[] = [
    {
      field: 'thumbnailUrl',
      headerName: 'Thumbnail',
      width: 72,
      sortable: false,
      renderCell: (r) => <VideoThumbnail row={r} className="size-11" />,
    },
    {
      field: 'videoTitle',
      headerName: 'Video',
      width: 260,
      valueGetter: (r) => r.videoTitle ?? `Video ${r.youtubeVideoId}`,
    },
    {
      field: 'channelName',
      headerName: 'Author / Channel',
      width: 160,
      valueGetter: (r) => r.channelName ?? '—',
    },
    {
      field: 'youtubeUrl',
      headerName: 'Link',
      width: 90,
      sortable: false,
      renderCell: (r) => (
        <a
          href={r.youtubeUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          YouTube
          <ExternalLinkIcon className="size-3.5" />
        </a>
      ),
    },
    {
      field: 'progressPercent',
      headerName: 'Progress',
      width: 170,
      renderCell: (r) => (
        <div className="flex w-full flex-col gap-1 py-1">
          <div className="flex items-center gap-2">
            <Progress value={r.progressPercent} className="w-20" />
            <span className="text-muted-foreground text-xs tabular-nums">{r.progressPercent}%</span>
          </div>
          {isActive(r) && r.statusMessage && (
            <span className="text-muted-foreground truncate text-xs">{r.statusMessage}</span>
          )}
        </div>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      width: 110,
      valueGetter: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      field: 'actions',
      headerName: 'Options',
      width: 160,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <RowActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setViewing(r)}
                aria-label={`View ${r.videoTitle ?? 'import'}`}
              >
                <EyeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {r.status === YoutubeImportStatus.FAILED
                ? 'View error'
                : isActive(r)
                  ? 'View status'
                  : 'View extracted recipe'}
            </TooltipContent>
          </Tooltip>
          {r.status === YoutubeImportStatus.READY && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => navigate(`/recipes/new?youtubeImportId=${r.id}`)}
                  aria-label={`Review recipe from ${r.videoTitle ?? 'import'}`}
                >
                  <ChefHatIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Review &amp; save to Recipe Master</TooltipContent>
            </Tooltip>
          )}
          {r.status === YoutubeImportStatus.SAVED && r.recipeId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => navigate(`/recipes/${r.recipeId}/edit`)}
                  aria-label={`View saved recipe from ${r.videoTitle ?? 'import'}`}
                >
                  <ChefHatIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View recipe</TooltipContent>
            </Tooltip>
          )}
          {r.status === YoutubeImportStatus.FAILED && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRetry(r)}
                  disabled={retry.isPending}
                  aria-label={`Retry ${r.videoTitle ?? 'import'}`}
                >
                  <RotateCwIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retry</TooltipContent>
            </Tooltip>
          )}
          <DeleteAction
            label={r.videoTitle ?? 'import'}
            disabled={isActive(r) && r.status !== YoutubeImportStatus.QUEUED}
            tooltip={
              isActive(r) && r.status !== YoutubeImportStatus.QUEUED
                ? 'Still processing — wait for it to finish or fail'
                : 'Delete import'
            }
            onClick={() => setDeleting(r)}
          />
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Catalogue/Collection"
        title="Youtube Recipe Downloader"
        subtitle="Pull a recipe out of a video, then review and correct the extraction before it becomes a recipe."
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        activeFilterCount={status ? 1 : 0}
        onClearFilters={() => setStatus('')}
        filters={
          <SelectField
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as YoutubeImportStatus | '')}
            emptyLabel="All statuses"
            options={enumOptions(YoutubeImportStatus)}
          />
        }
        view={view}
        onViewChange={setView}
        page={1}
        pageSize={rows.length || 1}
        total={rows.length}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        onCreate={() => setImportOpen(true)}
        createLabel="Import video"
      />

      {view === 'table' ? (
        <DataTable
          gridId="youtube-imports"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={(r) => setViewing(r)}
          filtered={filtersActive}
          emptyTitle="No YouTube imports yet"
          emptyMessage="Paste a YouTube video link and the recipe it teaches will be extracted for review."
          emptyAction={{ label: 'Import video', onClick: () => setImportOpen(true) }}
        />
      ) : (
        <EntityCardGrid
          rows={rows}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setViewing(r)}
          filtered={filtersActive}
          emptyTitle="No YouTube imports yet"
          emptyMessage="Paste a YouTube video link and the recipe it teaches will be extracted for review."
          emptyAction={{ label: 'Import video', onClick: () => setImportOpen(true) }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <VideoThumbnail row={r} className="aspect-video w-full" />
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">
                  {r.videoTitle ?? `Video ${r.youtubeVideoId}`}
                </p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">{r.channelName ?? 'Unknown channel'}</p>
              <div className="flex items-center gap-2">
                <Progress value={r.progressPercent} className="flex-1" />
                <span className="text-muted-foreground text-xs tabular-nums">{r.progressPercent}%</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{new Date(r.createdAt).toLocaleDateString()}</Badge>
                {isActive(r) && r.statusMessage && <Badge variant="outline">{r.statusMessage}</Badge>}
              </div>
            </div>
          )}
        />
      )}

      <ImportUrlDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <YoutubeImportDetailDialog
        importId={viewing?.id ?? null}
        onClose={() => setViewing(null)}
        onReview={(id) => navigate(`/recipes/new?youtubeImportId=${id}`)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete YouTube import"
        message={`Delete the import of "${deleting?.videoTitle ?? deleting?.youtubeUrl ?? 'this video'}"? The extracted recipe data will be lost${deleting?.recipeId ? ' (the saved Recipe Master record is kept)' : ''
          }.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

/** Paste-URL dialog. Submitting returns immediately — processing continues server-side. */
function ImportUrlDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateYoutubeImport();

  async function onImport(): Promise<void> {
    setError(null);
    try {
      await create.mutateAsync(url);
      notify.success('Import queued — the video is being processed in the background.');
      setUrl('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="youtube-import-url"
      title="Import a YouTube recipe video"
      open={open}
      onClose={() => {
        setUrl('');
        setError(null);
        onClose();
      }}
      minWidth={440}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onImport} disabled={create.isPending || !url.trim()}>
            {create.isPending ? 'Queuing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="YouTube URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          helperText="Watch, Shorts and youtu.be links are supported. You can keep working while the video processes."
          error={error ?? undefined}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim() && !create.isPending) void onImport();
          }}
        />
      </div>
    </Modal>
  );
}
