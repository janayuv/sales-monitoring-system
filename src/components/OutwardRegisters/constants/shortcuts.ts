export interface KeyboardShortcut {
  keyCombo: string;
  description: string;
}

export const SHORTCUTS: KeyboardShortcut[] = [
  { keyCombo: "Ctrl + F", description: "Focus Search Bar" },
  { keyCombo: "Ctrl + E", description: "Export CSV" },
  { keyCombo: "Esc", description: "Clear All Filters" },
  { keyCombo: "Alt + ←", description: "Previous Page" },
  { keyCombo: "Alt + →", description: "Next Page" },
];
