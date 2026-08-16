import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, KeyRound, Server, Check } from "lucide-react";
import { getSettings, saveGeminiKey, regenerateMcpToken, BACKEND_URL } from "@/lib/api";
import { TID } from "@/constants/testIds";

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [newKey, setNewKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState({});

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied({ ...copied, [label]: true });
      setTimeout(() => setCopied((c) => ({ ...c, [label]: false })), 1500);
    } catch {
      toast.error("Clipboard blocked");
    }
  };

  const doSaveKey = async () => {
    setSavingKey(true);
    try {
      const next = await saveGeminiKey(newKey.trim() || null);
      setSettings(next);
      setNewKey("");
      toast.success(newKey.trim() ? "Custom key saved" : "Reverted to Emergent universal key");
    } catch {
      toast.error("Save failed");
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async () => {
    setSavingKey(true);
    try {
      const next = await saveGeminiKey("");
      setSettings(next);
      toast.success("Reverted to Emergent universal key");
    } finally {
      setSavingKey(false);
    }
  };

  const regen = async () => {
    if (!window.confirm("Regenerate MCP token? Existing Claude connectors will stop working.")) return;
    setRegenerating(true);
    try {
      const token = await regenerateMcpToken();
      setSettings({ ...settings, mcp_token: token });
      toast.success("Token regenerated");
    } finally {
      setRegenerating(false);
    }
  };

  if (!settings) {
    return <div className="p-10 text-zinc-500 font-mono text-sm">Loading…</div>;
  }

  const mcpUrl = `${BACKEND_URL}/api/mcp`;
  const claudeUrl = settings.mcp_connect_url || `${BACKEND_URL}/api/mcp/${settings.mcp_token}/`;

  return (
    <div data-testid={TID.settings.root} className="min-h-full px-6 md:px-10 py-10 max-w-[900px] mx-auto">
      <header className="mb-10">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">Settings</div>
        <h1 className="mt-1 text-4xl sm:text-5xl font-heading font-semibold tracking-tight">
          Keys &amp; connectors
        </h1>
      </header>

      {/* API Key */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 grid place-items-center shrink-0">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h2 className="font-heading text-xl tracking-tight">Google Gemini API key</h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Currently using{" "}
              <span className="font-mono text-zinc-200">
                {settings.gemini_api_key_source === "user_override"
                  ? "your custom key"
                  : "the Emergent universal key"}
              </span>
              . Paste your own key to override for production usage.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
          <input
            data-testid={TID.settings.keyInput}
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={settings.gemini_api_key_set ? "•••••• (paste new key to replace)" : "AIza…"}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:border-zinc-500 transition-colors"
          />
          <button
            data-testid={TID.settings.keySaveBtn}
            onClick={doSaveKey}
            disabled={savingKey || !newKey}
            className="rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {savingKey ? "Saving…" : "Save key"}
          </button>
          {settings.gemini_api_key_set && (
            <button
              data-testid={TID.settings.keyClearBtn}
              onClick={clearKey}
              disabled={savingKey}
              className="rounded-lg border border-zinc-800 hover:border-zinc-600 px-4 py-2.5 text-sm text-zinc-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 font-mono">
          Keys are stored server-side and never exposed to the browser.
        </p>
      </section>

      {/* MCP */}
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 grid place-items-center shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-heading text-xl tracking-tight">MCP for Claude</h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Add this app as a custom connector in Claude Desktop / claude.ai and generate images from
              Claude conversations.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                Recommended for claude.ai
              </span>
            </div>
            <p className="text-[12px] text-zinc-300 mb-2 leading-relaxed">
              Paste this single URL into <span className="font-mono">Settings → Connectors → Add custom connector</span>.
              Leave OAuth fields blank — the token is embedded in the URL.
            </p>
            <FieldRow
              label="Claude URL"
              value={claudeUrl}
              testId="settings-mcp-claude-url"
              copyTestId="settings-mcp-copy-claude-url"
              copied={copied.claudeUrl}
              onCopy={() => copy("claudeUrl", claudeUrl)}
              secretMask
            />
          </div>

          <FieldRow
            label="Server URL"
            value={mcpUrl}
            testId={TID.settings.mcpUrl}
            copyTestId={TID.settings.mcpCopyUrl}
            copied={copied.url}
            onCopy={() => copy("url", mcpUrl)}
          />
          <FieldRow
            label="Auth token"
            value={settings.mcp_token}
            testId={TID.settings.mcpToken}
            copyTestId={TID.settings.mcpCopyToken}
            copied={copied.token}
            onCopy={() => copy("token", settings.mcp_token)}
            secretMask
          />
          <button
            data-testid={TID.settings.mcpRegenerate}
            onClick={regen}
            disabled={regenerating}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-600 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate token
          </button>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-2">
            How to connect from Claude
          </div>
          <ol className="text-xs text-zinc-300 space-y-1.5 list-decimal pl-4">
            <li>Open Claude → Settings → Connectors → “Add custom connector”.</li>
            <li>
              Paste the <span className="font-mono text-zinc-100">Claude URL</span> above into the URL
              field (it already contains your token). Leave OAuth fields empty.
            </li>
            <li>
              Click Connect. Claude will discover 6 tools:{" "}
              <span className="font-mono">generate_image</span>,{" "}
              <span className="font-mono">bulk_generate</span>,{" "}
              <span className="font-mono">get_batch_status</span>,{" "}
              <span className="font-mono">list_style_presets</span>,{" "}
              <span className="font-mono">create_style_preset</span>,{" "}
              <span className="font-mono">list_gallery</span>.
            </li>
            <li>
              For Claude Desktop or CLI clients that support Bearer tokens, you can instead use the
              plain Server URL above and send the token in an{" "}
              <span className="font-mono">Authorization: Bearer</span> header.
            </li>
          </ol>
          <div className="text-[11px] text-zinc-500 mt-3">
            Try: <span className="italic text-zinc-300">generate 20 cinematic portrait prompts and render them all with my Neon Noir style preset.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function FieldRow({ label, value, testId, copyTestId, copied, onCopy, secretMask }) {
  const [reveal, setReveal] = useState(false);
  const shown = secretMask && !reveal ? value.replace(/./g, "•") : value;
  return (
    <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_auto] gap-2 items-center">
      <div className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">{label}</div>
      <input
        readOnly
        data-testid={testId}
        value={shown}
        className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm font-mono outline-none"
      />
      <div className="flex gap-1.5">
        {secretMask && (
          <button
            onClick={() => setReveal((v) => !v)}
            className="text-[11px] px-2.5 py-1.5 rounded-md border border-zinc-800 hover:border-zinc-600 hover:text-zinc-100 text-zinc-400 transition-colors"
          >
            {reveal ? "hide" : "show"}
          </button>
        )}
        <button
          data-testid={copyTestId}
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 text-zinc-900 hover:bg-white text-xs font-medium px-3 py-1.5 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
