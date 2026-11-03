import { create } from 'zustand'

export type HelpTab = 'shortcuts' | 'glossary'

interface HelpState {
  isOpen: boolean
  tab: HelpTab
  /** Open the help dialog, optionally on a given tab. */
  openHelp: (tab?: HelpTab) => void
  closeHelp: () => void
  setTab: (tab: HelpTab) => void
}

/**
 * Whether the "Help & reference" dialog is open. It is mounted once (in
 * MainLayout) and opened from the header button, the user menu and the `?` key,
 * so the open state lives here rather than in any one of them.
 */
export const useHelpStore = create<HelpState>((set) => ({
  isOpen: false,
  tab: 'shortcuts',
  openHelp: (tab) => set((state) => ({ isOpen: true, tab: tab ?? state.tab })),
  closeHelp: () => set({ isOpen: false }),
  setTab: (tab) => set({ tab }),
}))
