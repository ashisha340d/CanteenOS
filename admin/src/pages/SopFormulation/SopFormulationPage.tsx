import { ModulePage } from '@/components/ModulePage';
import { IngredientCategoriesPage } from '../IngredientCategories/IngredientCategoriesPage';
import { IngredientsPage } from '../Ingredients/IngredientsPage';
import { RecipesPage } from '../Recipes/RecipesPage';
import { YoutubeImportsPage } from '../YoutubeImports/YoutubeImportsPage';
import { SopModulePlaceholder } from './SopModulePlaceholder';

export function SopFormulationPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="sop-formulation"
      eyebrow="SOP Formulation"
      title="Recipe & Ingredient Standards"
      subtitle="Ingredients, categories, recipes and video-based recipe imports."
      defaultTab="sop"
      tabs={[
        { key: 'sop', label: 'SOP', content: <SopModulePlaceholder /> },
        { key: 'ingredient-categories', label: 'Ingredient Categories', content: <IngredientCategoriesPage /> },
        { key: 'ingredients', label: 'Ingredients', content: <IngredientsPage /> },
        { key: 'downloader', label: 'Recipe Downloader', content: <YoutubeImportsPage /> },
        { key: 'recipes', label: 'Recipes', content: <RecipesPage /> },
      ]}
    />
  );
}

