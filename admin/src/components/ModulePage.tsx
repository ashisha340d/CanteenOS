import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getModuleTab, setModuleTab } from '@/services/desktopState';

export interface ModuleTab {
  key: string;
  label: string;
  content: ReactNode;
}

interface ModulePageProps {
  /** Stable slug — the selected tab is persisted under it in the desktop state blob. */
  moduleId: string;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  tabs: ModuleTab[];
  defaultTab?: string;
  hideHeader?: boolean;
}

export function ModulePage({ moduleId, title, subtitle, eyebrow, tabs, defaultTab, hideHeader }: ModulePageProps): JSX.Element {
  const fallback = defaultTab ?? tabs[0]?.key ?? '';
  // Controlled so the choice survives reloads and module relaunches.
  const [active, setActive] = useState(() => {
    const saved = getModuleTab(moduleId);
    return saved && tabs.some((tab) => tab.key === saved) ? saved : fallback;
  });

  return (
    <>
      {!hideHeader && title && <PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} />}
      <Tabs
        value={active}
        onValueChange={(next) => {
          setActive(next);
          setModuleTab(moduleId, next);
        }}
        className="flex min-h-0 flex-col gap-3"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-0">
            <div className="embedded-page">{tab.content}</div>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
