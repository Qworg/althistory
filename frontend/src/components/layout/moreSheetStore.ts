import { create } from 'zustand'

interface MoreSheetState {
  isOpen: boolean
  setOpen: (open: boolean) => void
}

/**
 * Whether the mobile "More" sheet is open. Below `lg` the toolbar keeps only
 * the view's primary actions; graph management (the Graph menu, Compare
 * branches, Import, Ingest) and streaming move to a sheet opened from the
 * MobileBottomBar's "More" button. The sheet is drawn by the ViewToolbar,
 * which owns those actions, their dialogs and the streaming connection, so the
 * open state lives here rather than in either of them.
 */
export const useMoreSheetStore = create<MoreSheetState>((set) => ({
  isOpen: false,
  setOpen: (isOpen) => set({ isOpen }),
}))
