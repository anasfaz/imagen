import React from "react";
import { NavLink } from "react-router-dom";
import {
  Sparkles,
  Layers,
  Library,
  Images,
  Settings as SettingsIcon,
  Palette,
} from "lucide-react";
import { TID } from "@/constants/testIds";

const links = [
  { to: "/studio", label: "Studio", icon: Sparkles, testId: TID.sidebar.studio, hint: "Text-to-image & references" },
  { to: "/bulk", label: "Bulk", icon: Layers, testId: TID.sidebar.bulk, hint: "Batch many prompts" },
  { to: "/presets", label: "Style Presets", icon: Palette, testId: TID.sidebar.presets, hint: "Saved reference styles" },
  { to: "/gallery", label: "Gallery", icon: Images, testId: TID.sidebar.gallery, hint: "History & lightbox" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testId: TID.sidebar.settings, hint: "API key & MCP" },
];

export default function Sidebar() {
  return (
    <aside
      data-testid={TID.sidebar.nav}
      className="w-[240px] shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex flex-col"
    >
      <div className="px-5 pt-6 pb-5 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-zinc-100 text-zinc-900 grid place-items-center">
            <Library className="w-4 h-4" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-heading font-semibold text-[15px] tracking-tight">Imagen Studio</div>
            <div className="text-[11px] text-zinc-500 font-mono">by nano banana</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, label, icon: Icon, testId, hint }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={testId}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                "transition-[background-color,color] duration-150",
                isActive
                  ? "bg-zinc-800/80 text-zinc-50"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900",
              ].join(" ")
            }
          >
            <Icon className="w-4 h-4" strokeWidth={2} />
            <div className="flex-1">
              <div className="font-medium leading-none">{label}</div>
              <div className="text-[10.5px] text-zinc-500 mt-1 group-hover:text-zinc-400 leading-none">{hint}</div>
            </div>
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-zinc-800/80">
        <div className="rounded-lg px-3 py-3 bg-zinc-900/70 border border-zinc-800">
          <div className="text-[11px] text-zinc-500 font-mono">MCP endpoint</div>
          <div className="text-[11.5px] text-zinc-300 font-mono truncate">/api/mcp</div>
          <NavLink
            to="/settings"
            className="mt-2 inline-flex text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Configure for Claude →
          </NavLink>
        </div>
      </div>
    </aside>
  );
}
