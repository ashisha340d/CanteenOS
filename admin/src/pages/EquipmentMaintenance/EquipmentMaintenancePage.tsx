import { ModulePage } from '@/components/ModulePage';
import { EquipmentDashboardPage } from '../Equipment/EquipmentDashboardPage';
import { EquipmentListPage } from '../Equipment/EquipmentListPage';
import { MaintenanceTicketsPage } from '../Maintenance/MaintenanceTicketsPage';
import { MaintenanceSchedulesPage } from '../Maintenance/MaintenanceSchedulesPage';
import { SuppliersPage } from '../Suppliers/SuppliersPage';

export function EquipmentMaintenancePage(): JSX.Element {
  return (
    <ModulePage
      moduleId="equipment-maintenance"
      eyebrow="Equipment"
      title="Equipment & Maintenance"
      subtitle="Assets, maintenance tickets, schedules and service suppliers."
      defaultTab="overview"
      tabs={[
        { key: 'overview', label: 'Overview', content: <EquipmentDashboardPage /> },
        { key: 'assets', label: 'Assets', content: <EquipmentListPage /> },
        { key: 'tickets', label: 'Maintenance', content: <MaintenanceTicketsPage /> },
        { key: 'schedules', label: 'Schedules', content: <MaintenanceSchedulesPage /> },
        { key: 'suppliers', label: 'Suppliers', content: <SuppliersPage /> },
      ]}
    />
  );
}

