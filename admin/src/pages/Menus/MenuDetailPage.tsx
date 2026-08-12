import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MediaEntityType,
  type MenuCategoryAssignmentDto,
  type MenuItemAssignmentDto,
} from '@menuboard/shared';
import { ImagesIcon, PlusIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { BackButton } from '../../components/BackButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusChip } from '../../components/StatusChip';
import { menuCategoriesApi, menuItemsApi } from '../../api/masters';
import {
  useAssignMenuCategory,
  useAssignMenuItem,
  useMenu,
  useMenuCategoryAssignments,
  useMenuItemAssignments,
  useRemoveMenuCategoryAssignment,
  useRemoveMenuItemAssignment,
} from '../../hooks/useMenuMaster';
import { notify } from '@/lib/notify';
import { CategoryAssignmentFormModal } from './CategoryAssignmentFormModal';
import { MediaStrip } from './MediaStrip';
import { MenuItemAssignmentFormModal } from './MenuItemAssignmentFormModal';
import { SimplePickerDialog } from './SimplePickerDialog';
import { VariantSummary } from './VariantSummary';

export function MenuDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { id: menuId = '' } = useParams();
  const { data: menu } = useMenu(menuId);

  const { data: categoryAssignments } = useMenuCategoryAssignments(menuId, true);
  const assignCategory = useAssignMenuCategory(menuId);
  const removeCategoryAssignment = useRemoveMenuCategoryAssignment(menuId);

  const itemQuery = useMemo(() => ({ menuId, page: 1, pageSize: 100 }), [menuId]);
  const { data: itemAssignments } = useMenuItemAssignments(itemQuery);
  const assignItem = useAssignMenuItem(menuId);
  const removeItemAssignment = useRemoveMenuItemAssignment();

  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const { data: categoryOptions, isFetching: categoryOptionsLoading } = useQuery({
    queryKey: ['category-picker', categorySearch],
    queryFn: () => menuCategoriesApi.list({ search: categorySearch || undefined, page: 1, pageSize: 20 }),
    enabled: categoryPickerOpen,
  });

  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const { data: foodItemOptions, isFetching: foodItemOptionsLoading } = useQuery({
    queryKey: ['food-item-picker', itemSearch],
    queryFn: () => menuItemsApi.list({ search: itemSearch || undefined, page: 1, pageSize: 20 }),
    enabled: itemPickerOpen,
  });

  const [editingCategory, setEditingCategory] = useState<MenuCategoryAssignmentDto | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<MenuItemAssignmentDto | null>(null);
  const [removingCategory, setRemovingCategory] = useState<{ id: string; name: string } | null>(null);
  const [removingItem, setRemovingItem] = useState<MenuItemAssignmentDto | null>(null);

  const assignedCategoryIds = new Set((categoryAssignments ?? []).map((c) => c.categoryId));
  const assignedFoodItemIds = new Set((itemAssignments?.items ?? []).map((i) => i.foodItemId));

  async function confirmRemoveCategory(): Promise<void> {
    if (!removingCategory) return;
    try {
      await removeCategoryAssignment.mutateAsync(removingCategory.id);
      notify.success('Category removed from menu.');
      setRemovingCategory(null);
    } catch (err) {
      notify.fromError(err);
      setRemovingCategory(null);
    }
  }

  async function confirmRemoveItem(): Promise<void> {
    if (!removingItem) return;
    try {
      await removeItemAssignment.mutateAsync(removingItem.id);
      notify.success('Item removed from menu.');
      setRemovingItem(null);
    } catch (err) {
      notify.fromError(err);
      setRemovingItem(null);
    }
  }

  return (
    <>
      <BackButton to="/menus" label="Back to menus" />

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {menu?.name ?? 'Menu'}
          </h1>
          {menu && <StatusChip status={menu.status} />}
          {menu && (
            <Badge variant={menu.publishedAt ? 'secondary' : 'outline'}>
              {menu.publishedAt ? 'Published' : 'Draft'}
            </Badge>
          )}
        </div>
        {menu?.description && <p className="text-muted-foreground text-sm">{menu.description}</p>}

        <div className="mt-1">
          <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium">
            <ImagesIcon className="size-3.5" />
            Menu images
          </p>
          <MediaStrip entityType={MediaEntityType.MENU} entityId={menuId} />
        </div>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Categories</h2>
          <Button variant="outline" size="sm" onClick={() => setCategoryPickerOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add category
          </Button>
        </div>
        {(categoryAssignments ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No categories on this menu yet — add one from the existing category master.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(categoryAssignments ?? []).map((category) => (
              <Badge key={category.id} variant="outline" className="gap-1.5 py-1.5 pr-1.5 pl-2.5">
                <button
                  type="button"
                  className="focus-ring rounded-sm hover:underline"
                  onClick={() => setEditingCategory(category)}
                >
                  {category.displayName ?? category.categoryName}
                </button>
                <button
                  type="button"
                  className="focus-ring hover:text-destructive rounded-sm"
                  aria-label={`Remove ${category.categoryName}`}
                  onClick={() =>
                    setRemovingCategory({
                      id: category.id,
                      name: category.displayName ?? category.categoryName ?? '',
                    })
                  }
                >
                  <XIcon className="size-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Menu items</h2>
          <Button variant="outline" size="sm" onClick={() => setItemPickerOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Assign food item
          </Button>
        </div>

        {(itemAssignments?.items ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No items assigned yet — search the existing Food Item Master to add one.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-left font-medium">Availability</th>
                  <th className="px-3 py-2 text-left font-medium">Variants</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(itemAssignments?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.displayName ?? item.foodItemName}</p>
                      {item.displayName && (
                        <p className="text-muted-foreground text-xs">{item.foodItemName}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{item.availability}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <VariantSummary
                        foodItemId={item.foodItemId}
                        basePrice={item.foodItemBasePrice ?? null}
                        onManage={() => navigate('/menu-items')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={item.status} />
                    </td>
                    <td className="px-3 py-2">
                      <RowActions>
                        <EditAction
                          label={item.foodItemName ?? ''}
                          onClick={() => setEditingAssignment(item)}
                        />
                        <DeleteAction
                          label={item.foodItemName ?? ''}
                          tooltip="Remove — refused once a variant has been ordered"
                          onClick={() => setRemovingItem(item)}
                        />
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SimplePickerDialog
        id="menu-category"
        title="Add category"
        open={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        loading={categoryOptionsLoading}
        onSearchChange={setCategorySearch}
        options={(categoryOptions?.items ?? [])
          .filter((c) => !assignedCategoryIds.has(c.id))
          .map((c) => ({ id: c.id, label: c.name }))}
        onSelect={async (option) => {
          setCategoryPickerOpen(false);
          try {
            await assignCategory.mutateAsync({ categoryId: option.id });
            notify.success(`${option.label} added to menu.`);
          } catch (err) {
            notify.fromError(err);
          }
        }}
      />

      <SimplePickerDialog
        id="food-item"
        title="Assign food item"
        open={itemPickerOpen}
        onClose={() => setItemPickerOpen(false)}
        loading={foodItemOptionsLoading}
        onSearchChange={setItemSearch}
        options={(foodItemOptions?.items ?? [])
          .filter((i) => !assignedFoodItemIds.has(i.id))
          .map((i) => ({ id: i.id, label: i.name, sublabel: i.unit }))}
        onSelect={async (option) => {
          setItemPickerOpen(false);
          try {
            await assignItem.mutateAsync({ foodItemId: option.id });
            notify.success(`${option.label} assigned to menu.`);
          } catch (err) {
            notify.fromError(err);
          }
        }}
      />

      <CategoryAssignmentFormModal
        open={Boolean(editingCategory)}
        menuId={menuId}
        assignment={editingCategory}
        onClose={() => setEditingCategory(null)}
      />

      <MenuItemAssignmentFormModal
        open={Boolean(editingAssignment)}
        assignment={editingAssignment}
        onClose={() => setEditingAssignment(null)}
      />

      <ConfirmDialog
        open={Boolean(removingCategory)}
        title="Remove category"
        message={`Remove "${removingCategory?.name}" from this menu? Refused while any item on this menu still uses it.`}
        confirmLabel="Remove"
        danger
        loading={removeCategoryAssignment.isPending}
        onConfirm={confirmRemoveCategory}
        onCancel={() => setRemovingCategory(null)}
      />

      <ConfirmDialog
        open={Boolean(removingItem)}
        title="Remove item"
        message={`Remove "${removingItem?.foodItemName}" from this menu? Refused once a variant has been ordered.`}
        confirmLabel="Remove"
        danger
        loading={removeItemAssignment.isPending}
        onConfirm={confirmRemoveItem}
        onCancel={() => setRemovingItem(null)}
      />
    </>
  );
}
