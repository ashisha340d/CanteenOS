import {
  YoutubeImportStatus,
  YOUTUBE_IMPORT_ACTIVE_STATUSES,
  type YoutubeExtractedRecipe,
} from '@menuboard/shared';
import { CheckCircle2Icon, ChefHatIcon, CircleAlertIcon, ExternalLinkIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '../../components/Modal/Modal';
import { StatusChip } from '../../components/StatusChip';
import { useYoutubeImport } from '../../hooks/useYoutubeImports';
import { TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function ingredientAmount(ing: YoutubeExtractedRecipe['ingredients'][number]): string {
  if (ing.quantity !== null) return `${ing.quantity} ${ing.unit ?? ''}`.trim();
  if (ing.quantityText) return ing.quantityText;
  return '';
}

/**
 * Read-only view of one import: live progress while processing, the error for a failed run,
 * and the full extracted recipe (with its Ingredient Master matches) once READY. Editing
 * happens in the existing recipe editor via "Review", never here.
 */
export function YoutubeImportDetailDialog({
  importId,
  onClose,
  onReview,
}: {
  importId: string | null;
  onClose: () => void;
  onReview: (id: string) => void;
}): JSX.Element {
  const { data: record, isLoading } = useYoutubeImport(importId ?? undefined);
  const open = Boolean(importId);
  const recipe = record?.extractedRecipe ?? null;
  const active = record ? YOUTUBE_IMPORT_ACTIVE_STATUSES.includes(record.status) : false;

  return (
    <Modal
      id="youtube-import-detail"
      title={record?.videoTitle ?? 'YouTube import'}
      open={open}
      onClose={onClose}
      minWidth={560}
      minHeight={420}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {record?.status === YoutubeImportStatus.READY && (
            <Button type="button" onClick={() => onReview(record.id)}>
              <ChefHatIcon data-icon="inline-start" />
              Review &amp; save to Recipe Master
            </Button>
          )}
        </>
      }
    >
      {isLoading || !record ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="text-muted-foreground size-6" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={record.status} />
            {record.channelName && <Badge variant="outline">{record.channelName}</Badge>}
            <Badge variant="outline">{formatDuration(record.durationSec)}</Badge>
            <a
              href={record.youtubeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            >
              Open on YouTube
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </div>

          {record.thumbnailUrl && (
            <img
              src={record.thumbnailUrl}
              alt=""
              className="max-h-40 w-full rounded-lg border object-cover"
            />
          )}

          {active && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Progress value={record.progressPercent} className="flex-1" />
                <span className="text-sm font-medium tabular-nums">{record.progressPercent}%</span>
              </div>
              <p className="text-muted-foreground text-sm">
                {record.statusMessage ?? 'Waiting in the queue…'} You can keep working — this list
                updates automatically.
              </p>
            </div>
          )}

          {record.status === YoutubeImportStatus.FAILED && (
            <Alert variant="destructive">
              <AlertDescription>
                {record.errorMessage ?? 'Processing failed for an unknown reason.'}
              </AlertDescription>
            </Alert>
          )}

          {recipe && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{recipe.recipeName}</Badge>
                {recipe.servings !== null && <Badge variant="outline">Serves {recipe.servings}</Badge>}
                {recipe.prepTimeMin !== null && <Badge variant="outline">Prep {recipe.prepTimeMin} min</Badge>}
                {recipe.cookTimeMin !== null && <Badge variant="outline">Cook {recipe.cookTimeMin} min</Badge>}
                {recipe.difficulty && <Badge variant="outline">{recipe.difficulty}</Badge>}
                {recipe.cuisine && <Badge variant="outline">{recipe.cuisine}</Badge>}
              </div>

              {recipe.description && (
                <p className="text-muted-foreground text-sm">{recipe.description}</p>
              )}

              <div>
                <p className="mb-1 text-sm font-medium">
                  Ingredients ({recipe.ingredients.length}) — matched against the Ingredient Master
                </p>
                <ul className="flex flex-col gap-1">
                  {recipe.ingredients.map((ing, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      {ing.ingredientId ? (
                        <CheckCircle2Icon
                          className={cn('size-4 shrink-0', TONE_TEXT_CLASS.success)}
                          aria-label="Matched to an Ingredient Master record"
                        />
                      ) : (
                        <CircleAlertIcon
                          className={cn('size-4 shrink-0', TONE_TEXT_CLASS.danger)}
                          aria-label="No Ingredient Master match — resolve during review"
                        />
                      )}
                      <span className="text-muted-foreground min-w-16">{ingredientAmount(ing)}</span>
                      <span>
                        {ing.name}
                        {ing.preparation ? `, ${ing.preparation}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {recipe.steps.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">Method ({recipe.steps.length} steps)</p>
                  <ol className="text-muted-foreground flex list-inside list-decimal flex-col gap-1 text-sm">
                    {recipe.steps.map((step, i) => (
                      <li key={i}>
                        {step.instruction}
                        {step.durationMin !== null && ` (${step.durationMin} min)`}
                        {step.temperature && ` — ${step.temperature}`}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {(recipe.equipment.length > 0 ||
                recipe.tips.length > 0 ||
                recipe.garnish ||
                recipe.storageInstructions ||
                recipe.dietaryInfo.length > 0 ||
                recipe.allergens.length > 0) && (
                  <div className="text-muted-foreground flex flex-col gap-1 text-sm">
                    {recipe.equipment.length > 0 && <p>Equipment: {recipe.equipment.join(', ')}</p>}
                    {recipe.garnish && <p>Garnish: {recipe.garnish}</p>}
                    {recipe.tips.length > 0 && <p>Tips: {recipe.tips.join(' · ')}</p>}
                    {recipe.storageInstructions && <p>Storage: {recipe.storageInstructions}</p>}
                    {recipe.shelfLife && <p>Shelf life: {recipe.shelfLife}</p>}
                    {recipe.dietaryInfo.length > 0 && <p>Dietary: {recipe.dietaryInfo.join(', ')}</p>}
                    {recipe.allergens.length > 0 && <p>Allergens: {recipe.allergens.join(', ')}</p>}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
