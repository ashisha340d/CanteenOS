import { forwardRef, useId, type ReactNode } from 'react';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Thin wrappers over the shadcn Field primitives.
 *
 * Every form in the portal previously used MUI's `<TextField label … error helperText>` in
 * one line; rebuilding each as five hand-composed elements would have been fifteen pages of
 * near-identical markup and fifteen chances to drift. These keep the one-line call site and
 * the label/description/error wiring — including the `data-invalid`/`aria-invalid` pairing
 * and the generated `aria-describedby` — correct and identical everywhere.
 */

/** Stable across re-renders, unique across instances — what label/aria wiring needs. */
function useFieldId(explicit?: string): string {
  const generated = useId();
  return explicit ?? generated;
}

interface BaseFieldProps {
  label?: string;
  /** Sub-label guidance shown under the control when there is no error. */
  helperText?: ReactNode;
  /** Error text. Presence flips the field into its invalid state. */
  error?: string | null | undefined;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/* ------------------------------------------------------------------------ text input */

export interface TextFieldProps
  extends BaseFieldProps,
    Omit<React.ComponentProps<'input'>, 'className' | 'id' | 'disabled' | 'required'> {
  /** Renders a Textarea instead of an Input. */
  multiline?: boolean;
  rows?: number;
}

/**
 * Ref-forwarding matters here: `react-hook-form`'s `register()` hands back a `ref` alongside
 * the change handlers, and on React 18 a plain function component silently drops it — the
 * field would register but never read its value.
 */
export const TextField = forwardRef<HTMLInputElement & HTMLTextAreaElement, TextFieldProps>(
  function TextField(
    { label, helperText, error, required, disabled, className, id, multiline, rows = 3, ...props },
    ref,
  ) {
    const fieldId = useFieldId(id);
    const describedBy = error
      ? `${fieldId}-error`
      : helperText
        ? `${fieldId}-description`
        : undefined;

    return (
      <Field
        data-invalid={error ? true : undefined}
        data-disabled={disabled || undefined}
        className={className}
      >
        {label && (
          <FieldLabel htmlFor={fieldId}>
            {label}
            {required && <RequiredMark />}
          </FieldLabel>
        )}
        {multiline ? (
          <Textarea
            ref={ref}
            id={fieldId}
            rows={rows}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...(props as React.ComponentProps<'textarea'>)}
          />
        ) : (
          <Input
            ref={ref}
            id={fieldId}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...props}
          />
        )}
        {error ? (
          <FieldError id={`${fieldId}-error`}>{error}</FieldError>
        ) : (
          helperText && (
            <FieldDescription id={`${fieldId}-description`}>{helperText}</FieldDescription>
          )
        )}
      </Field>
    );
  },
);

/* ---------------------------------------------------------------------- number input */

export type NumberFieldProps = Omit<TextFieldProps, 'type' | 'multiline'>;

/**
 * A number input with the browser spin buttons removed (in index.css) and
 * mouse-wheel-over-focused-field blurring instead of silently changing the value
 * (docs/AGENTS.md Modal/Form Standard, handled centrally here rather than per-form).
 */
export const NumberField = forwardRef<HTMLInputElement & HTMLTextAreaElement, NumberFieldProps>(
  function NumberField({ onWheel, ...props }, ref) {
    return (
      <TextField
        {...props}
        ref={ref}
        type="number"
        inputMode="decimal"
        onWheel={(event) => {
          (event.target as HTMLInputElement).blur();
          onWheel?.(event);
        }}
      />
    );
  },
);

/* ---------------------------------------------------------------------------- select */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Label for the "no filter" choice. Providing it prepends an option with value `''`. */
  emptyLabel?: string;
  triggerClassName?: string;
}

/**
 * Radix's Select forbids an empty-string item value (it reserves `''` to mean "nothing
 * selected"), but every filter in the portal models "All roles" / "All statuses" as exactly
 * that. The sentinel is swapped in on the way down and back out again on the way up, so
 * callers keep using `''` and never learn this exists.
 */
const EMPTY_SENTINEL = '__all__';

export function SelectField({
  label,
  helperText,
  error,
  required,
  disabled,
  className,
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyLabel,
  triggerClassName,
}: SelectFieldProps): JSX.Element {
  const fieldId = useFieldId(id);
  const describedBy = error ? `${fieldId}-error` : helperText ? `${fieldId}-description` : undefined;

  return (
    <Field data-invalid={error ? true : undefined} data-disabled={disabled || undefined} className={className}>
      {label && (
        <FieldLabel htmlFor={fieldId}>
          {label}
          {required && <RequiredMark />}
        </FieldLabel>
      )}
      <Select
        value={value === '' ? (emptyLabel ? EMPTY_SENTINEL : '') : value}
        onValueChange={(next) => onChange(next === EMPTY_SENTINEL ? '' : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id={fieldId}
          className={cn('w-full', triggerClassName)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {emptyLabel && <SelectItem value={EMPTY_SENTINEL}>{emptyLabel}</SelectItem>}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error ? (
        <FieldError id={`${fieldId}-error`}>{error}</FieldError>
      ) : (
        helperText && <FieldDescription id={`${fieldId}-description`}>{helperText}</FieldDescription>
      )}
    </Field>
  );
}

/* -------------------------------------------------------------------- switch/checkbox */

interface ToggleFieldProps extends BaseFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}

export function SwitchField({
  label,
  helperText,
  checked,
  onCheckedChange,
  disabled,
  className,
  id,
}: ToggleFieldProps): JSX.Element {
  const fieldId = useFieldId(id);
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined} className={className}>
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        {helperText && <FieldDescription>{helperText}</FieldDescription>}
      </FieldContent>
      <Switch id={fieldId} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </Field>
  );
}

export function CheckboxField({
  label,
  helperText,
  checked,
  onCheckedChange,
  disabled,
  className,
  id,
}: ToggleFieldProps): JSX.Element {
  const fieldId = useFieldId(id);
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined} className={className}>
      <Checkbox
        id={fieldId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
      />
      <FieldContent>
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        {helperText && <FieldDescription>{helperText}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}

/* --------------------------------------------------------------------------- layout */

function RequiredMark(): JSX.Element {
  return (
    <span aria-hidden className="text-destructive ml-0.5">
      *
    </span>
  );
}

/** Vertical rhythm for a stack of fields. Re-exported so pages import one module. */
export { FieldGroup };

/**
 * Two-column field layout that collapses to one column on narrow screens — the standard
 * arrangement for the record forms, which pair short related values (unit + quantity,
 * email + phone) side by side on a desktop dialog and stack them in a mobile sheet.
 */
export function FieldRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}
