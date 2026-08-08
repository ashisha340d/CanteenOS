import { useEffect, useState } from 'react';
import { CheckIcon, SearchIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from './Modal/Modal';
import { cn } from '@/lib/utils';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface SearchPickerFieldProps {
  id: string;
  label: string;
  value: string | null;
  displayValue: string;
  options: PickerOption[];
  loading?: boolean;
  onSearchChange: (search: string) => void;
  onSelect: (option: PickerOption) => void;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Google-style instant-search modal picker for large lookup/master lists, replacing a plain
 * native select (docs/AGENTS.md Modal/Form Standard). Filtering happens on the server, so
 * Command's own client-side matching is switched off — otherwise it would filter the already
 * filtered results a second time and hide valid matches.
 */
export function SearchPickerField({
  id,
  label,
  value,
  displayValue,
  options,
  loading,
  onSearchChange,
  onSelect,
  disabled,
  required,
}: SearchPickerFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) onSearchChange(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

  return (
    <>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor={`picker-input-${id}`}>
          {label}
          {required && (
            <span aria-hidden className="text-destructive ml-0.5">
              *
            </span>
          )}
        </FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            id={`picker-input-${id}`}
            readOnly
            role="combobox"
            aria-expanded={open}
            value={displayValue}
            placeholder="Click to search…"
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!disabled) setOpen(true);
              }
            }}
            className="cursor-pointer"
          />
        </InputGroup>
      </Field>

      <Modal
        id={`picker-${id}`}
        title={`Select ${label}`}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={420}
        minHeight={420}
      >
        <Command shouldFilter={false} className="h-full">
          <CommandInput
            autoFocus
            placeholder="Type to search…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-none">
            {loading && (
              <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
                <Spinner />
                Searching…
              </div>
            )}
            {!loading && options.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
            {options.length > 0 && (
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => {
                      onSelect(option);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="touch-target"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.sublabel && (
                        <span className="text-muted-foreground truncate text-xs">
                          {option.sublabel}
                        </span>
                      )}
                    </div>
                    <CheckIcon
                      className={cn('ml-auto', option.id === value ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </Modal>
    </>
  );
}
