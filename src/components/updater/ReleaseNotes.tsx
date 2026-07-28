// src/components/updater/ReleaseNotes.tsx
import React, { useMemo } from "react";

interface ReleaseNotesProps {
  notes: string;
}

export const ReleaseNotes: React.FC<ReleaseNotesProps> = ({ notes }) => {
  const renderedElements = useMemo(() => {
    if (!notes) return <p className="text-slate-400 italic">No release details provided.</p>;

    const lines = notes.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();

      // Headers
      if (trimmed.startsWith("###")) {
        return (
          <h4 key={idx} className="text-xs font-bold text-slate-200 mt-4 mb-2 uppercase tracking-wide text-indigo-400">
            {trimmed.replace(/^###\s*/, "")}
          </h4>
        );
      }
      if (trimmed.startsWith("##")) {
        return (
          <h3 key={idx} className="text-sm font-bold text-slate-100 mt-5 mb-3">
            {trimmed.replace(/^##\s*/, "")}
          </h3>
        );
      }
      if (trimmed.startsWith("#")) {
        return (
          <h2 key={idx} className="text-base font-bold text-white mt-6 mb-4 border-b border-slate-800 pb-2">
            {trimmed.replace(/^#\s*/, "")}
          </h2>
        );
      }

      // Horizontal Rule
      if (trimmed === "---") {
        return <hr key={idx} className="my-4 border-slate-800" />;
      }

      // Checkbox list items
      if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [ ]")) {
        const checked = trimmed.startsWith("- [x]");
        const text = trimmed.replace(/^- \[[x\s]\]\s*/, "");
        return (
          <div key={idx} className="flex items-center gap-2 text-xs text-slate-300 my-1 font-mono pl-4">
            <input type="checkbox" checked={checked} readOnly className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5" />
            <span>{text}</span>
          </div>
        );
      }

      // Bullet points
      if (trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("✓")) {
        const cleanText = trimmed.replace(/^[-*✓]\s*/, "");
        
        // Parse bold elements inside line: **text** -> strong
        const boldRegex = /\*\*(.*?)\*\*/g;
        const parts = [];
        let lastIndex = 0;
        let match;
        
        while ((match = boldRegex.exec(cleanText)) !== null) {
          if (match.index > lastIndex) {
            parts.push(cleanText.substring(lastIndex, match.index));
          }
          parts.push(<strong key={match.index} className="font-bold text-slate-100">{match[1]}</strong>);
          lastIndex = boldRegex.lastIndex;
        }
        if (lastIndex < cleanText.length) {
          parts.push(cleanText.substring(lastIndex));
        }

        return (
          <li key={idx} className="text-xs text-slate-300 list-none flex items-start gap-2 my-1.5 pl-2 leading-relaxed">
            <span className="text-indigo-400 flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
            <span>{parts.length > 0 ? parts : cleanText}</span>
          </li>
        );
      }

      // Default paragraph (skip empty lines)
      if (!trimmed) return <div key={idx} className="h-2" />;

      return (
        <p key={idx} className="text-xs text-slate-400 leading-relaxed my-2">
          {trimmed}
        </p>
      );
    });
  }, [notes]);

  return (
    <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-5 max-h-[300px] overflow-y-auto custom-scrollbar space-y-1">
      {renderedElements}
    </div>
  );
};
