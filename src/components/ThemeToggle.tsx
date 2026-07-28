import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export const ThemeToggle: React.FC<{ showLabel?: boolean }> = ({ showLabel = false }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer bg-[var(--ember-surface)] hover:bg-[var(--ember-surface-raised)] border-[var(--ember-border)] text-[var(--ember-text-primary)] hover:border-[var(--ember-primary)] shadow-sm focus:outline-none"
      title={`Switch to ${isDark ? "Light Mode" : "Dark Mode"}`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isDark ? (
          <Moon className="w-4 h-4 text-amber-400 transition-transform duration-200 rotate-0" />
        ) : (
          <Sun className="w-4 h-4 text-orange-600 transition-transform duration-200 rotate-0" />
        )}
      </div>
      {showLabel && (
        <span className="text-xs font-medium">
          {isDark ? "Dark Mode" : "Light Mode"}
        </span>
      )}
    </button>
  );
};
