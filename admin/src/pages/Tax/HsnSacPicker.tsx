import { useEffect, useState } from 'react';
import { Capability, HsnSacCodeType, type HsnSacCodeDto } from '@menuboard/shared';
import { CheckIcon, SearchIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useHsnSacCode, useHsnSacSearch } from '../../hooks/useTax';
import { useAuth } from '../../services/AuthContext';
import { cn } from '@/lib/utils';

/**
 * Search-and-select over the synchronized HSN/SAC master.
 *
 * A code can only be chosen from the master — there is no free-text entry, because an
 * unvalidated classification code is worse than none. Deactivated codes are hidden unless the
 * caller holds TAX_OVERRIDE, which is the administrator override the specification allows.
 */
export function HsnSacPicker({
  value,
  onChange,
  supplyType,
  label = 'HSN / SAC Code',
  disabled,
  error,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Restricts the search to SAC for services and HSN for goods. */
  supplyType?: 'GOODS' | 'SERVICE' | null;
  label?: string;
  disabled?: boolean;
  error?: string | null;
}): JSX.Element {
  const { hasCapability } = useAuth();
  const canOverride = hasCapability(Capability.TAX_OVERRIDE);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  // The master holds ~22,000 rows; searching on every keystroke would be one request per
  // character for no benefit, since the user is still typing a code.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const codeType =
    supplyType === 'SERVICE'
      ? HsnSacCodeType.SAC
      : supplyType === 'GOODS'
        ? HsnSacCodeType.HSN
        : undefined;

  const { data, isFetching } = useHsnSacSearch(
    {
      q: debounced || undefined,
      ...(codeType ? { codeType } : {}),
      activeOnly: !canOverride,
      pageSize: 20,
    },
    open,
  );

  // The selected code is fetched by id so an existing assignment still renders its
  // description when it is not in the current search results — including a deactivated one.
  const selected = useHsnSacCode(value);
  const current: HsnSacCodeDto | undefined = selected.data;

  return (
    <Field data-invalid={error ? true : undefined} data-disabled={disabled || undefined}>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              className="min-w-0 flex-1 justify-start font-normal"
            >
              <SearchIcon className="text-muted-foreground" />
              {current ? (
                <span className="truncate">
                  <span className="font-mono font-medium">{current.code}</span>
                  <span className="text-muted-foreground"> — {current.description}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Search HSN/SAC code or description…</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(34rem,90vw)] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search HSN/SAC code or description…"
                value={term}
                onValueChange={setTerm}
              />
              <CommandList>
                {isFetching && (
                  <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm">
                    <Spinner className="size-4" /> Searching…
                  </div>
                )}
                {!isFetching && (data?.items.length ?? 0) === 0 && (
                  <CommandEmpty>
                    {debounced === ''
                      ? 'Type a code or a description to search.'
                      : 'No matching HSN/SAC code. If the master is empty, run Sync GST Master first.'}
                  </CommandEmpty>
                )}
                <CommandGroup>
                  {data?.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => {
                        onChange(item.id);
                        setOpen(false);
                      }}
                      className="items-start gap-2"
                    >
                      <CheckIcon
                        className={cn('mt-0.5 size-4', item.id === value ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">{item.code}</span>
                          <Badge variant="outline" className="text-[0.625rem]">
                            {item.codeType}
                          </Badge>
                          {!item.isActive && (
                            <Badge variant="secondary" className="text-[0.625rem]">
                              Deactivated
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground block text-xs">{item.description}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {value !== null && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear HSN/SAC code"
            onClick={() => onChange(null)}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {current && !current.isActive && (
        <FieldDescription className="text-warning-foreground">
          This code is no longer published in the official GST dataset. It is kept so existing
          references resolve; choose a current code when convenient.
        </FieldDescription>
      )}
      {error ? (
        <FieldDescription className="text-destructive">{error}</FieldDescription>
      ) : (
        current && (
          <FieldDescription>
            {current.codeType}: {current.description}
          </FieldDescription>
        )
      )}
    </Field>
  );
}
