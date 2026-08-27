import { useEffect, useRef, useState } from "react";
import "./Settings.css";
import {
  createHtmlAudioPlayer,
  MAX_AUDIO_VOLUME,
  type AudioPlayer,
} from "./audio";
import { invoke } from "@tauri-apps/api/core";
import { loadConfig, saveConfig, type AppConfig } from "./config";

type SaveState =
  | { type: "idle" }
  | { type: "saved" }
  | { type: "error"; message: string };

const LEGACY_F7_URL =
  "wss://f7livemanager.salutproductionscontact.workers.dev/ws";
const RECOMMENDED_F7_URL = "wss://f7flags.saluthostedthis.tech/ws";
const pluginsAvailable = import.meta.env.VITE_PORTABLE !== "true";

function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ type: "idle" });
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [pluginInstallStatus, setPluginInstallStatus] = useState<string | null>(
    null,
  );
  const testPlayerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadConfig()
      .then((loaded) => {
        if (!cancelled) {
          setConfig(loaded);
        }
      })
      .catch((error) => {
        console.error("Failed to load config:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pluginsOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPluginsOpen(false);
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [pluginsOpen]);

  if (!config) {
    return <main className="settings">Loading…</main>;
  }

  function update(patch: Partial<AppConfig>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
    setSaveState({ type: "idle" });
  }

  function handleTestAudio() {
    if (!config) {
      return;
    }

    if (!testPlayerRef.current) {
      testPlayerRef.current = createHtmlAudioPlayer();
    }

    testPlayerRef.current.setVolume(config.audioVolume);
    testPlayerRef.current.play(["sc"]);
  }

  async function handleSave() {
    if (!config) {
      return;
    }

    try {
      await saveConfig(config);
      setSaveState({ type: "saved" });
    } catch (error) {
      setSaveState({ type: "error", message: String(error) });
    }
  }

  async function handleSwitchUrl() {
    if (!config) {
      return;
    }

    const next = { ...config, websocketUrl: RECOMMENDED_F7_URL };
    setConfig(next);

    try {
      await saveConfig(next);
      setSaveState({ type: "saved" });
    } catch (error) {
      setSaveState({ type: "error", message: String(error) });
    }
  }

  async function handleInstallSimHubPlugin() {
    setPluginInstallStatus(null);

    try {
      const installedPath = await invoke<string>("install_simhub_plugin");
      setPluginInstallStatus(`Installed to ${installedPath}. Restart SimHub.`);
    } catch (error) {
      setPluginInstallStatus(String(error));
    }
  }

  const volumePercent = Math.round(config.audioVolume * 100);
  const volumeWarning = volumePercent > 100;

  return (
    <main className="settings">
      <h1>Settings</h1>

      <section>
        <h2>Connection</h2>
        {config.websocketUrl === LEGACY_F7_URL && (
          <div className="notice">
            <p>
              IMPORTANT NOTICE: From the 4th of September, the Legacy endpoint may no longer be available. Please switch to the new endpoint as soon as possible to ensure correct functionality of the application.
              F7R's marshal board server has moved. We recommend switching to
              the new address: <code>{RECOMMENDED_F7_URL}</code>
            </p>
            <button type="button" onClick={handleSwitchUrl}>
              Switch now
            </button>
          </div>
        )}
        <label className="field">
          <span>WebSocket URL</span>
          <input
            type="text"
            value={config.websocketUrl}
            onChange={(event) => update({ websocketUrl: event.target.value })}
            spellCheck={false}
          />
        </label>
      </section>

      <section>
        <h2>Window</h2>
        <div className="field-row">
          <label className="field">
            <span>Default width</span>
            <input
              type="number"
              min={170}
              value={config.defaultWidth}
              onChange={(event) =>
                update({ defaultWidth: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Default height</span>
            <input
              type="number"
              min={70}
              value={config.defaultHeight}
              onChange={(event) =>
                update({ defaultHeight: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <p className="hint">Default size will apply on next launch.</p>
        <label className="check">
          <input
            type="checkbox"
            checked={config.alwaysOnTop}
            onChange={(event) => update({ alwaysOnTop: event.target.checked })}
          />
          <span>Always on top</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.roundedCorners}
            onChange={(event) =>
              update({ roundedCorners: event.target.checked })
            }
          />
          <span>Rounded corners</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.transparency}
            onChange={(event) =>
              update({ transparency: event.target.checked })
            }
          />
          <span>Transparent background</span>
        </label>
      </section>

      <section>
        <h2>Audio callouts</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={config.audioEnabled}
            onChange={(event) => update({ audioEnabled: event.target.checked })}
          />
          <span>Enable voice callouts</span>
        </label>
        <label className="field">
          <span>Volume: {volumePercent}%</span>
          <div className="volume-row">
            <input
              type="range"
              min={0}
              max={MAX_AUDIO_VOLUME * 100}
              value={volumePercent}
              onChange={(event) =>
                update({ audioVolume: Number(event.target.value) / 100 })
              }
            />
            <button type="button" onClick={handleTestAudio}>
              Test
            </button>
          </div>
          {volumeWarning && (
            <span className="badge warn" role="status">
              ⚠ High level caution — distortion may occur in some cases
            </span>
          )}
        </label>
      </section>

      {pluginsAvailable && (
        <section>
          <h2>Plugins</h2>
          <button type="button" onClick={() => setPluginsOpen(true)}>
            Manage plugins
          </button>
        </section>
      )}

      {pluginsAvailable && pluginsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setPluginsOpen(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugins-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <h2 id="plugins-title">Plugins</h2>
              <button
                type="button"
                className="modal-close"
                aria-label="Close plugins"
                onClick={() => setPluginsOpen(false)}
              >
                ×
              </button>
            </header>
            <ul className="plugin-list">
              <li className="plugin-card">
                <div className="plugin-card-copy">
                  <h3>SimHub LED effects</h3>
                  <p>Shares MarshalBoards flags with SimHub LED hardware.</p>
                  <code>ws://127.0.0.1:{config.simhubRelayPort}/flags</code>
                </div>
                <label className="plugin-toggle">
                  <input
                    type="checkbox"
                    checked={config.simhubRelayEnabled}
                    onChange={(event) =>
                      update({ simhubRelayEnabled: event.target.checked })
                    }
                  />
                  <span>
                    {config.simhubRelayEnabled ? "Enabled" : "Disabled"}
                  </span>
                </label>
                <label className="field plugin-port">
                  <span>Port</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={config.simhubRelayPort}
                    onChange={(event) =>
                      update({ simhubRelayPort: Number(event.target.value) })
                    }
                  />
                </label>
                <p className="hint">
                  Port changes apply after restarting MarshalBoards.
                </p>
                <button
                  type="button"
                  className="plugin-install"
                  onClick={handleInstallSimHubPlugin}
                >
                  Install to SimHub
                </button>
                {pluginInstallStatus && (
                  <p className="plugin-install-status" role="status">
                    {pluginInstallStatus}
                  </p>
                )}
              </li>
            </ul>
          </section>
        </div>
      )}

      <footer>
        <button type="button" className="save" onClick={handleSave}>
          Save
        </button>
        {saveState.type === "saved" && <span className="status ok">Saved</span>}
        {saveState.type === "error" && (
          <span className="status error">{saveState.message}</span>
        )}
      </footer>
    </main>
  );
}

export default Settings;
