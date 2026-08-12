import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import Sidebar from "@/components/Sidebar";
import Studio from "@/pages/Studio";
import BulkPage from "@/pages/BulkPage";
import Gallery from "@/pages/Gallery";
import Presets from "@/pages/Presets";
import Settings from "@/pages/Settings";

function Shell({ children }) {
  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex">
      <Sidebar />
      <main className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "4px 4px",
        }} />
        <div className="relative h-screen overflow-y-auto custom-scroll">
          {children}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Toaster richColors theme="dark" position="top-right" closeButton />
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/studio" replace />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/bulk" element={<BulkPage />} />
          <Route path="/presets" element={<Presets />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/studio" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}

export default App;
