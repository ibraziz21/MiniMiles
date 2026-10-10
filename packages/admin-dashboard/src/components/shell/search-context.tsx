"use client";

import { createContext, useContext } from "react";

const CommandSearchContext = createContext<(() => void) | null>(null);

export function CommandSearchProvider({
  open,
  children,
}: {
  open: () => void;
  children: React.ReactNode;
}) {
  return <CommandSearchContext.Provider value={open}>{children}</CommandSearchContext.Provider>;
}

/**
 * Lets any page's existing TopBar trigger the shell's single CommandSearch
 * instance without every one of TopBar's ~49 call sites needing to change —
 * only TopBar.tsx itself consumes this.
 */
export function useCommandSearchTrigger(): () => void {
  const open = useContext(CommandSearchContext);
  return open ?? (() => {});
}
