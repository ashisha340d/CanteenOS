import { useState, type ReactNode } from 'react';
import {
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { cn } from '@/lib/utils';

interface ListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  hideSearch?: boolean;
  filters?: ReactNode;
  activeFilterCount?: number;
  /** Clears every filter at once from the filter panel. */
  onClearFilters?: () => void;
  view: 'table' | 'card';
  onViewChange: (view: 'table' | 'card') => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onCreate?: () => void;
  createLabel?: string;
  extraActions?: ReactNode;
}

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The listing controls: search and filters on the left, view and creation on the right,
 * paging below. One bar, one place to look, identical on every list in the portal.
 *
 * On mobile the same controls are re-composed rather than merely wrapped — search takes the
 * full width, filters move into a bottom sheet with a proper Apply affordance, the view
 * toggle disappears (the grid renders as cards there regardless), and paging collapses to
 * prev/next with a position readout, because numbered page links are unhittable with a thumb.
 */
export function ListToolbar({
  search,
  onSearchChange,
  hideSearch,
  filters,
  activeFilterCount = 0,
  onClearFilters,
  view,
  onViewChange,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  onCreate,
  createLabel = 'New',
  extraActions,
}: ListToolbarProps): JSX.Element {
  const { isMobile } = useDeviceProfile();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPaging = total > pageSize;

  const countLabel =
    total === 0 ? 'No results' : `${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}`;

  const searchField = !hideSearch && (
    <InputGroup className={cn(isMobile ? 'w-full' : 'w-[268px]')}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        placeholder="Search…"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label="Search"
      />
      {search && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );

  const filtersButton = filters && (
    <Button
      variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
      size={isMobile ? 'default' : 'sm'}
      onClick={() => setFiltersOpen(true)}
      className={cn(isMobile && 'touch-target', activeFilterCount > 0 && 'border-primary')}
    >
      <SlidersHorizontalIcon data-icon="inline-start" />
      Filters
      {activeFilterCount > 0 && (
        <Badge variant="secondary" className="ml-1 tabular-nums">
          {activeFilterCount}
        </Badge>
      )}
    </Button>
  );

  const createButton = onCreate && (
    <Button onClick={onCreate} size={isMobile ? 'default' : 'sm'} className={cn(isMobile && 'touch-target flex-1')}>
      <PlusIcon data-icon="inline-start" />
      {createLabel}
    </Button>
  );

  const filterPanel = filters && (
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(isMobile ? 'max-h-[85dvh] rounded-t-2xl' : 'w-[340px] sm:max-w-[340px]')}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list down to what you need.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">{filters}</div>
        <SheetFooter>
          {onClearFilters && (
            <Button
              variant="outline"
              onClick={onClearFilters}
              disabled={activeFilterCount === 0}
              className={cn(isMobile && 'touch-target')}
            >
              Clear all
            </Button>
          )}
          <Button onClick={() => setFiltersOpen(false)} className={cn(isMobile && 'touch-target')}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );

  /* ---------------------------------------------------------------------- mobile */

  if (isMobile) {
    return (
      <div className="mb-4 flex flex-col gap-3">
        {searchField}
        <div className="flex items-center gap-2">
          {filtersButton}
          {extraActions}
          {createButton}
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">{countLabel}</p>

        {showPaging && (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              className="touch-target"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="text-muted-foreground text-sm tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="touch-target"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        )}

        {filterPanel}
      </div>
    );
  }

  /* --------------------------------------------------------------------- desktop */

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {searchField}
        {filtersButton}

        {/* The count belongs beside the search that produced it, not in a separate row. */}
        <span className="text-muted-foreground ml-1 text-sm whitespace-nowrap tabular-nums">
          {countLabel}
        </span>

        <div className="flex-1" />

        {extraActions}

        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(next) => next && onViewChange(next as 'table' | 'card')}
        >
          <ToggleGroupItem value="table" aria-label="Table view">
            <ListIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="card" aria-label="Card view">
            <LayoutGridIcon />
          </ToggleGroupItem>
        </ToggleGroup>

        {createButton}
      </div>

      {showPaging && (
        <div className="mt-3 flex items-center justify-end gap-4">
          <Select value={String(pageSize)} onValueChange={(next) => onPageSizeChange(Number(next))}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} per page
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  size="sm"
                  href="#"
                  aria-disabled={page <= 1}
                  className={cn(page <= 1 && 'pointer-events-none opacity-50')}
                  onClick={(event) => {
                    event.preventDefault();
                    if (page > 1) onPageChange(page - 1);
                  }}
                />
              </PaginationItem>
              {pageWindow(page, totalPages).map((entry) => (
                <PaginationItem key={entry}>
                  <PaginationLink
                    size="icon-sm"
                    href="#"
                    isActive={entry === page}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageChange(entry);
                    }}
                  >
                    {entry}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  size="sm"
                  href="#"
                  aria-disabled={page >= totalPages}
                  className={cn(page >= totalPages && 'pointer-events-none opacity-50')}
                  onClick={(event) => {
                    event.preventDefault();
                    if (page < totalPages) onPageChange(page + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {filterPanel}
    </div>
  );
}

/** At most five page links, centred on the current page and clamped to the ends. */
function pageWindow(page: number, totalPages: number): number[] {
  const span = Math.min(5, totalPages);
  let start = Math.max(1, page - Math.floor(span / 2));
  if (start + span - 1 > totalPages) start = totalPages - span + 1;
  return Array.from({ length: span }, (_unused, index) => start + index);
}
