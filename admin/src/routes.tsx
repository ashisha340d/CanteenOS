import { Capability } from '@menuboard/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { RequireCapability } from './services/CapabilityGate';
import { useAuth } from './services/AuthContext';
import { LoginPage } from './pages/Login/LoginPage';
import { ForcedChangePasswordPage } from './pages/ChangePassword/ForcedChangePasswordPage';
import { NotFoundPage } from './pages/NotFound';
import { PageSkeleton } from './components/ui/Skeletons';
import { Spinner } from '@/components/ui/spinner';

// Route-level code-splitting: every authenticated page beyond the dashboard is fetched on
// first navigation rather than bundled into the single initial chunk (this was the ~730 kB
// single-chunk `vite build` warning flagged in Phase 3/Phase 7). Login and the forced
// password-change gate stay eager, since they are on the critical path for every session.
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import('./pages/Users/UsersPage').then((m) => ({ default: m.UsersPage })));
const BoardsPage = lazy(() => import('./pages/Boards/BoardsPage').then((m) => ({ default: m.BoardsPage })));
const BoardMembersPage = lazy(() =>
  import('./pages/Boards/BoardMembersPage').then((m) => ({ default: m.BoardMembersPage })),
);
const StationsPage = lazy(() => import('./pages/Stations/StationsPage').then((m) => ({ default: m.StationsPage })));
const ActivityTypesPage = lazy(() =>
  import('./pages/ActivityTypes/ActivityTypesPage').then((m) => ({ default: m.ActivityTypesPage })),
);
const MenuCategoriesPage = lazy(() =>
  import('./pages/MenuCategories/MenuCategoriesPage').then((m) => ({ default: m.MenuCategoriesPage })),
);
const MenuItemsPage = lazy(() => import('./pages/MenuItems/MenuItemsPage').then((m) => ({ default: m.MenuItemsPage })));
const MenuItemFormPage = lazy(() =>
  import('./pages/MenuItems/MenuItemFormPage').then((m) => ({ default: m.MenuItemFormPage })),
);
const MenuItemDetailPage = lazy(() =>
  import('./pages/MenuItems/MenuItemDetailPage').then((m) => ({ default: m.MenuItemDetailPage })),
);
const MenusPage = lazy(() => import('./pages/Menus/MenusPage').then((m) => ({ default: m.MenusPage })));
const MenuDetailPage = lazy(() =>
  import('./pages/Menus/MenuDetailPage').then((m) => ({ default: m.MenuDetailPage })),
);
const ItemGroupsPage = lazy(() =>
  import('./pages/ItemGroups/ItemGroupsPage').then((m) => ({ default: m.ItemGroupsPage })),
);
const CountersPage = lazy(() => import('./pages/Counters/CountersPage').then((m) => ({ default: m.CountersPage })));
const PrintingGroupsPage = lazy(() =>
  import('./pages/PrintingGroups/PrintingGroupsPage').then((m) => ({ default: m.PrintingGroupsPage })),
);
const ModifierGroupsPage = lazy(() =>
  import('./pages/Modifiers/ModifierGroupsPage').then((m) => ({ default: m.ModifierGroupsPage })),
);
const IngredientCategoriesPage = lazy(() =>
  import('./pages/IngredientCategories/IngredientCategoriesPage').then((m) => ({
    default: m.IngredientCategoriesPage,
  })),
);
const IngredientsPage = lazy(() =>
  import('./pages/Ingredients/IngredientsPage').then((m) => ({ default: m.IngredientsPage })),
);
const RecipesPage = lazy(() => import('./pages/Recipes/RecipesPage').then((m) => ({ default: m.RecipesPage })));
const RecipeFormPage = lazy(() =>
  import('./pages/Recipes/RecipeFormPage').then((m) => ({ default: m.RecipeFormPage })),
);
const YoutubeImportsPage = lazy(() =>
  import('./pages/YoutubeImports/YoutubeImportsPage').then((m) => ({ default: m.YoutubeImportsPage })),
);
const TasksPage = lazy(() => import('./pages/Tasks/TasksPage').then((m) => ({ default: m.TasksPage })));
const HsnSacMasterPage = lazy(() =>
  import('./pages/Tax/HsnSacMasterPage').then((m) => ({ default: m.HsnSacMasterPage })),
);
const TaxProfilesPage = lazy(() =>
  import('./pages/Tax/TaxProfilesPage').then((m) => ({ default: m.TaxProfilesPage })),
);
const EntitiesPage = lazy(() =>
  import('./pages/Entities/EntitiesPage').then((m) => ({ default: m.EntitiesPage })),
);
const PosDashboardPage = lazy(() =>
  import('./pages/Pos/PosDashboardPage').then((m) => ({ default: m.PosDashboardPage })),
);
const PosEntryPage = lazy(() => import('./pages/Pos/PosEntryPage').then((m) => ({ default: m.PosEntryPage })));
const PosMargEntryPage = lazy(() =>
  import('./pages/Pos/PosMargEntryPage').then((m) => ({ default: m.PosMargEntryPage })),
);
const PermissionsPage = lazy(() =>
  import('./pages/Permissions/PermissionsPage').then((m) => ({ default: m.PermissionsPage })),
);
const ReportsPage = lazy(() => import('./pages/Reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const BillingPage = lazy(() => import('./pages/Billing/BillingPage').then((m) => ({ default: m.BillingPage })));
const AuditPage = lazy(() => import('./pages/Audit/AuditPage').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AlertsPage = lazy(() => import('./pages/Alerts/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const SecuritySettingsPage = lazy(() =>
  import('./pages/Account/SecuritySettingsPage').then((m) => ({ default: m.SecuritySettingsPage })),
);

/** Blocking full-window state, used only while the session itself is being resolved. */
function LoadingScreen(): JSX.Element {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner className="text-muted-foreground size-6" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * The chrome a full-bleed page still needs — safe-area padding and a max width — without
 * AppShell's sidebar, topbar or breadcrumbs. A counter screen has no use for navigation
 * chrome, and on the small screen a till usually runs on, the sidebar is real space.
 */
function FullBleedPage({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-h-dvh w-full overflow-x-hidden">{children}</div>;
}

export function AppRoutes(): JSX.Element {
  const { status, user } = useAuth();

  if (status === 'loading') return <LoadingScreen />;

  if (status === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Gate the whole app behind the forced password change screen (docs/TASK.md §6.2).
  if (user?.mustChangePassword) {
    return (
      <Routes>
        <Route path="/change-password" element={<ForcedChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }

  // Outer safety net only: AppShell declares its own Suspense around the outlet, and the
  // nearest boundary wins, so a lazily-loaded page replaces the content area rather than the
  // whole window. This catches anything rendered outside the shell.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />

        {/* The till runs full-bleed, outside AppShell: a counter screen has no use for the
            sidebar, breadcrumbs or command palette, and the sidebar's width is real space on
            what is usually a small screen at the register. */}
        <Route
          path="/pos"
          element={
            <RequireCapability capability={Capability.POS_READ}>
              <FullBleedPage>
                <PosDashboardPage />
              </FullBleedPage>
            </RequireCapability>
          }
        />
        <Route
          path="/pos/entry"
          element={
            <RequireCapability capability={Capability.POS_OPERATE}>
              <FullBleedPage>
                <PosEntryPage />
              </FullBleedPage>
            </RequireCapability>
          }
        />
        <Route
          path="/pos/marg"
          element={
            <RequireCapability capability={Capability.POS_OPERATE}>
              <FullBleedPage>
                <PosMargEntryPage />
              </FullBleedPage>
            </RequireCapability>
          }
        />
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/users"
            element={
              <RequireCapability capability={Capability.USER_READ}>
                <UsersPage />
              </RequireCapability>
            }
          />
          <Route
            path="/boards"
            element={
              <RequireCapability capability={Capability.BOARD_READ_ALL}>
                <BoardsPage />
              </RequireCapability>
            }
          />
          <Route path="/boards/:boardId/members" element={<BoardMembersPage />} />
          <Route
            path="/stations"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <StationsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/activity-types"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <ActivityTypesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menu-categories"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <MenuCategoriesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menu-items"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <MenuItemsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menu-items/new"
            element={
              <RequireCapability capability={Capability.MASTER_WRITE}>
                <MenuItemFormPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menu-items/:id"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <MenuItemDetailPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menu-items/:id/edit"
            element={
              <RequireCapability capability={Capability.MASTER_WRITE}>
                <MenuItemFormPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menus"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <MenusPage />
              </RequireCapability>
            }
          />
          <Route
            path="/menus/:id"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <MenuDetailPage />
              </RequireCapability>
            }
          />
          <Route
            path="/item-groups"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <ItemGroupsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/counters"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <CountersPage />
              </RequireCapability>
            }
          />
          <Route
            path="/printing-groups"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <PrintingGroupsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/modifiers"
            element={
              <RequireCapability capability={Capability.MASTER_READ}>
                <ModifierGroupsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/ingredient-categories"
            element={
              <RequireCapability capability={Capability.RECIPE_READ}>
                <IngredientCategoriesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/ingredients"
            element={
              <RequireCapability capability={Capability.RECIPE_READ}>
                <IngredientsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/recipes"
            element={
              <RequireCapability capability={Capability.RECIPE_READ}>
                <RecipesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/recipes/new"
            element={
              <RequireCapability capability={Capability.RECIPE_WRITE}>
                <RecipeFormPage />
              </RequireCapability>
            }
          />
          <Route
            path="/recipes/:id/edit"
            element={
              <RequireCapability capability={Capability.RECIPE_WRITE}>
                <RecipeFormPage />
              </RequireCapability>
            }
          />
          <Route
            path="/youtube-imports"
            element={
              <RequireCapability capability={Capability.RECIPE_WRITE}>
                <YoutubeImportsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/tasks"
            element={
              <RequireCapability capability={Capability.TASK_READ}>
                <TasksPage />
              </RequireCapability>
            }
          />
          <Route
            path="/hsn-sac"
            element={
              <RequireCapability capability={Capability.TAX_READ}>
                <HsnSacMasterPage />
              </RequireCapability>
            }
          />
          <Route
            path="/tax-profiles"
            element={
              <RequireCapability capability={Capability.TAX_READ}>
                <TaxProfilesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/entities"
            element={
              <RequireCapability capability={Capability.ENTITY_READ}>
                <EntitiesPage />
              </RequireCapability>
            }
          />
          <Route
            path="/permissions"
            element={
              <RequireCapability capability={Capability.PERMISSION_READ}>
                <PermissionsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/reports"
            element={
              <RequireCapability capability={Capability.REPORT_READ}>
                <ReportsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/billing"
            element={
              <RequireCapability capability={Capability.BILLING_READ}>
                <BillingPage />
              </RequireCapability>
            }
          />
          <Route
            path="/audit"
            element={
              <RequireCapability capability={Capability.AUDIT_READ}>
                <AuditPage />
              </RequireCapability>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireCapability capability={Capability.SETTINGS_READ}>
                <SettingsPage />
              </RequireCapability>
            }
          />
          <Route
            path="/alerts"
            element={
              <RequireCapability capability={Capability.ALERT_CONFIG}>
                <AlertsPage />
              </RequireCapability>
            }
          />
          <Route path="/account/security" element={<SecuritySettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
