import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the component tree beneath is being rendered inside a desktop window.
 *
 * A module reached by URL is a page and needs a page's chrome — a back link, a title telling
 * you where you are. The same module opened as a window already has both: the caption bar
 * names it and carries the close button. Repeating them inside the frame spends a strip of a
 * small window on information the frame around it is already showing.
 *
 * A context rather than a prop because the modules are rendered generically by the window
 * manager (`createElement(app.Component)`), so there is no call site to thread a flag through.
 */
const WindowHostContext = createContext(false);

export function WindowHostProvider({ children }: { children: ReactNode }): JSX.Element {
  return <WindowHostContext.Provider value={true}>{children}</WindowHostContext.Provider>;
}

/** True when this render is inside a desktop window rather than a routed page. */
export function useInWindow(): boolean {
  return useContext(WindowHostContext);
}
