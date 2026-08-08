import { useRef, useState } from 'react';
import { CheckCircle2Icon, CircleAlertIcon, MicIcon, SparklesIcon, SquareIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/form/fields';
import { Modal } from '../../components/Modal/Modal';
import { recipesApi, type ParsedRecipe } from '../../api/recipes';
import { readError } from '../../services/errorMessage';
import { TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';

/**
 * "Import from text" sub-dialog: paste free text -> rule-based parse -> optional AI resolution
 * for unmatched ingredients -> apply to the main form for review. Never auto-submits the
 * recipe itself — `onApply` only fills the caller's form state.
 */
export function RecipeImportDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (draft: ParsedRecipe) => void;
}): JSX.Element {
  const [rawText, setRawText] = useState('');
  const [draft, setDraft] = useState<ParsedRecipe | null>(null);
  const [parsing, setParsing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function onParse(): Promise<void> {
    if (!rawText.trim()) return;
    setError(null);
    setParsing(true);
    try {
      const parsed = await recipesApi.importParse(rawText);
      setDraft(parsed);
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setParsing(false);
    }
  }

  async function onResolveWithAi(): Promise<void> {
    if (!draft) return;
    setResolving(true);
    setError(null);
    try {
      const resolved = await recipesApi.importAi(rawText, draft, draft.unresolved);
      setDraft(resolved);
    } catch (err) {
      // /import/ai is best-effort and throws a clear message when GEMINI_API_KEY is unset —
      // surface it without treating it as a hard failure of the import flow.
      notify.error(readError(err).message || 'AI resolution not configured on this server.');
    } finally {
      setResolving(false);
    }
  }

  async function onToggleRecording(): Promise<void> {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void onTranscribe(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      notify.error('Microphone access was denied or is unavailable.');
    }
  }

  async function onTranscribe(blob: Blob): Promise<void> {
    setTranscribing(true);
    try {
      const { transcript } = await recipesApi.transcribe(blob);
      setRawText((prev) => (prev ? `${prev}\n${transcript}` : transcript));
    } catch (err) {
      notify.error(readError(err).message || 'Transcription is not configured on this server.');
    } finally {
      setTranscribing(false);
    }
  }

  function applyAndClose(): void {
    if (!draft) return;
    onApply(draft);
    reset();
    onClose();
  }

  function reset(): void {
    setRawText('');
    setDraft(null);
    setError(null);
  }

  return (
    <Modal
      id="recipe-import"
      title="Import recipe from text"
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      minWidth={520}
      minHeight={520}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!draft} onClick={applyAndClose}>
            Apply to form
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-end gap-2">
          <TextField
            className="flex-1"
            label="Recipe text"
            multiline
            rows={8}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            helperText="Paste a recipe (ingredients + method) or dictate it with the mic, then parse."
            placeholder={'Serves 100\n\n2 kg Wheat Flour\n1 tsp Salt\n\nInstructions:\n1. Mix flour and salt...'}
          />
          <Button
            type="button"
            variant={recording ? 'destructive' : 'outline'}
            size="icon"
            disabled={transcribing}
            onClick={onToggleRecording}
            aria-label={recording ? 'Stop recording' : 'Record a voice note'}
          >
            {transcribing ? <Spinner /> : recording ? <SquareIcon /> : <MicIcon />}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onParse} disabled={parsing || !rawText.trim()}>
            {parsing && <Spinner data-icon="inline-start" />}
            {parsing ? 'Parsing…' : 'Parse'}
          </Button>
        </div>

        {draft && (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{draft.itemName || 'Unnamed dish'}</Badge>
              <Badge variant="outline">{draft.basePax} pax</Badge>
              {draft.difficulty && <Badge variant="outline">{draft.difficulty}</Badge>}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Ingredients ({draft.ingredients.length})</p>
              <ul className="flex flex-col gap-1">
                {draft.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    {ing.ingredientId ? (
                      <CheckCircle2Icon className={cn('size-4 shrink-0', TONE_TEXT_CLASS.success)} />
                    ) : (
                      <CircleAlertIcon className={cn('size-4 shrink-0', TONE_TEXT_CLASS.danger)} />
                    )}
                    <span className="text-muted-foreground">
                      {ing.qtyForBasePax} {ing.unit ?? ''}
                    </span>
                    <span>{ing.name}</span>
                  </li>
                ))}
              </ul>
            </div>

            {draft.unresolved.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-destructive text-sm font-medium">
                  {draft.unresolved.length} item(s) could not be matched
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onResolveWithAi}
                  disabled={resolving}
                >
                  <SparklesIcon data-icon="inline-start" />
                  {resolving ? 'Resolving…' : 'Resolve unmatched with AI'}
                </Button>
              </div>
            )}

            <div>
              <p className="mb-1 text-sm font-medium">Steps ({draft.steps.length})</p>
              <ol className="text-muted-foreground list-inside list-decimal text-sm">
                {draft.steps.map((step, i) => (
                  <li key={i}>{step.textEn}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
