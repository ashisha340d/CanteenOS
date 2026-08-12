import { ChefHatIcon, PlusIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useDefaultRecipe } from '../../hooks/useRecipes';
import { recipesApi } from '../../api/recipes';
import { notify } from '@/lib/notify';
import { useQueryClient } from '@tanstack/react-query';

/**
 * "Recipe (lookup for recipe for it)" from the mockup — a food item's recipe lives in the
 * Recipe Master (recipes.menu_item_id), not on this form, so this is a lookup/shortcut, not an
 * editor: shows the current default recipe if one exists (with a Clear action) or "No Recipe"
 * with a shortcut to create one, and always a link into the full Recipe builder.
 */
export function RecipePickerButton({ menuItemId }: { menuItemId: string | null }): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: recipe, isLoading, isError } = useDefaultRecipe(menuItemId ?? undefined);
  const hasRecipe = Boolean(recipe) && !isError;

  async function clearRecipe(): Promise<void> {
    if (!recipe) return;
    try {
      await recipesApi.remove(recipe.id);
      qc.invalidateQueries({ queryKey: ['recipe-default', menuItemId] });
      qc.invalidateQueries({ queryKey: ['recipe-variants', menuItemId] });
      notify.success('Recipe cleared.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  if (!menuItemId) {
    return (
      <Button type="button" variant="outline" size="sm" disabled title="Save the item first">
        <ChefHatIcon data-icon="inline-start" />
        Recipe
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {isLoading ? <Spinner data-icon="inline-start" /> : <ChefHatIcon data-icon="inline-start" />}
          {hasRecipe ? 'Recipe linked' : 'No recipe'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>{hasRecipe ? recipe!.difficulty ? `Recipe · ${recipe!.difficulty}` : 'Recipe' : 'No recipe yet'}</PopoverTitle>
          <PopoverDescription>
            {hasRecipe
              ? `Base pax ${recipe!.basePax}. Ingredients, method and steps live in the Recipe Master.`
              : 'This item has no recipe in the Recipe Master yet.'}
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() =>
              hasRecipe
                ? navigate(`/recipes/${recipe!.id}/edit`)
                : navigate(`/recipes/new?menuItemId=${menuItemId}`)
            }
          >
            {hasRecipe ? 'Edit recipe' : <><PlusIcon data-icon="inline-start" />Create recipe</>}
          </Button>
          {hasRecipe && (
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={clearRecipe}>
              <XIcon data-icon="inline-start" />
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
