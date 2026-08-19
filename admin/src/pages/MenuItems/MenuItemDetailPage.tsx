import { MediaEntityType } from '@menuboard/shared';
import { ChefHatIcon, ImageIcon, PencilIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BackButton } from '../../components/BackButton';
import { PageSkeleton } from '../../components/ui/Skeletons';
import { StatusChip } from '../../components/StatusChip';
import { useMediaForEntity } from '@/hooks/useMedia';
import { useMenuItem } from '../../hooks/useMasters';
import { useMenuItemSchedule, useMenuItemVariants } from '../../hooks/useMenuMaster';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Read-only view of one dish: its photography, what it costs in each portion, and where it is
 * routed — the screen to open when you want to look something up rather than change it. Every
 * value here is editable one click away, on the form this page links to.
 */
export function MenuItemDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();

  const { data: item, isLoading } = useMenuItem(id);
  const { data: images } = useMediaForEntity(MediaEntityType.MENU_ITEM, id);
  const { data: variants } = useMenuItemVariants(id);
  const { data: schedule } = useMenuItemSchedule(id);

  const categoryName = item?.categoryName ?? item?.categoryId ?? '—';
  const groupName = item?.groupName ?? item?.groupId ?? '—';

  if (isLoading || !item) return <PageSkeleton />;

  const gallery = images ?? [];
  const primary = gallery.find((a) => a.isPrimary) ?? gallery[0];
  const heroUrl = primary?.media?.url ?? item.primaryMediaUrl ?? item.imagePath;
  const availableSlots = (schedule?.slots ?? []).filter((s) => s.isAvailable);

  return (
    <>
      <div className="mb-3 flex items-center gap-3 border-b pb-3 text-sm">
        <BackButton to="/menu-items" label="Back to Master Menu" />
        <StatusChip status={item.status} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/recipes?menuItemId=${id}`)}>
            <ChefHatIcon data-icon="inline-start" />
            Recipes
          </Button>
          <Button size="sm" onClick={() => navigate(`/menu-items/${id}/edit`)}>
            <PencilIcon data-icon="inline-start" />
            Edit item
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="flex flex-col gap-2">
          <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border">
            {heroUrl ? (
              <img
                src={heroUrl}
                alt={primary?.media?.altText ?? item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs">
                <ImageIcon className="size-5 opacity-50" />
                No image yet
              </div>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gallery.map((assignment) => (
                <div
                  key={assignment.id}
                  className="bg-muted size-14 overflow-hidden rounded-md border"
                >
                  {assignment.media && (
                    <img
                      src={assignment.media.url}
                      alt={assignment.media.altText ?? assignment.media.fileName}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">{item.name}</h1>
            {item.nameHi && <p className="text-muted-foreground text-sm">{item.nameHi}</p>}
          </div>

          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-3 text-base font-semibold">Details</h2>
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
              <DetailRow label="Category" value={categoryName} />
              <DetailRow label="Unit" value={item.unitHi ? `${item.unit} · ${item.unitHi}` : item.unit} />
              <DetailRow
                label="Base price"
                value={item.basePrice === null ? '—' : `₹${item.basePrice}`}
              />
              <DetailRow label="Sort order" value={String(item.sortOrder)} />
            </dl>
          </section>

          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-3 text-base font-semibold">Pricing & Variants</h2>
            {(variants ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No variants — the base price applies to the whole item.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(variants ?? []).map((variant) => (
                  <Badge key={variant.id} variant={variant.isDefault ? 'secondary' : 'outline'}>
                    {variant.name} ₹{variant.price}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-3 text-base font-semibold">Groups & Availability</h2>
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-muted-foreground mb-1.5 text-xs font-medium">Item group</p>
                {groupName ? (
                  <Badge variant="outline">{groupName}</Badge>
                ) : (
                  <p className="text-muted-foreground">Not tagged to any group.</p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground mb-1.5 text-xs font-medium">Availability</p>
                {schedule?.alwaysAvailable !== false ? (
                  <Badge variant="secondary">Always available</Badge>
                ) : availableSlots.length === 0 ? (
                  <p className="text-muted-foreground">No slots are marked available.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableSlots.map((slot) => (
                      <Badge key={`${slot.dayOfWeek}-${slot.shift}`} variant="outline">
                        {DAY_LABELS[slot.dayOfWeek]} · {slot.shift.toLowerCase()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}
