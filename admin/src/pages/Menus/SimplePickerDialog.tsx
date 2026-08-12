import { useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '../../components/Modal/Modal';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface SimplePickerDialogProps {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  options: PickerOption[];
  loading?: boolean;
  onSearchChange: (search: string) => void;
  onSelect: (option: PickerOption) => void;
}

/**
 * A one-shot "search and pick" dialog for adding an existing master record to a menu — the
 * same server-filtered Command pattern as SearchPickerField, but standalone (it fires
 * `onSelect` immediately rather than binding to a form field), used for "+ Add category" and
 * "+ Assign food item" on the Menu detail page.
 */
export function SimplePickerDialog({
  id,
  title,
  open,
  onClose,
  options,
  loading,
  onSearchChange,
  onSelect,
}: SimplePickerDialogProps): JSX.Element {
  const [search, setSearch] = useState('');

  return (
    <Modal id={`picker-${id}`} title={title} open={open} onClose={onClose} minWidth={420} minHeight={420}>
      <Command shouldFilter={false} className="h-full">
        <CommandInput
          autoFocus
          placeholder="Type to search…"
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            onSearchChange(value);
          }}
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
                    setSearch('');
                  }}
                  className="touch-target"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.sublabel && (
                      <span className="text-muted-foreground truncate text-xs">{option.sublabel}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </Modal>
  );
}
