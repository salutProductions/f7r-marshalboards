import { useEffect, useRef, useState } from "react";
import "./Settings.css";
import { createHtmlAudioPlayer, type AudioPlayer } from "./audio";
import { loadConfig, saveConfig, type AppConfig } from "./config";

type SaveState =
  | { type: "idle" }
  | { type: "saved" }
  | { type: "error"; message: string };

const LEGACY_F7_URL =
  "wss://f7livemanager.salutproductionscontact.workers.dev/ws";
const RECOMMENDED_F7_URL = "wss://f7flags.saluthostedthis.tech/ws";

function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ type: "idle" });
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

  const volumePercent = Math.round(config.audioVolume * 100);

  return (
    <main className="settings">
      <h1>Settings</h1>

      <section>
        <h2>Connection</h2>
        {config.websocketUrl === LEGACY_F7_URL && (
          <div className="notice">
            <p>
              F7's marshal board server has moved. We recommend switching to
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
        <p className="hint">Default size applies on next launch.</p>
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
              max={100}
              value={volumePercent}
              onChange={(event) =>
                update({ audioVolume: Number(event.target.value) / 100 })
              }
            />
            <button type="button" onClick={handleTestAudio}>
              Test
            </button>
          </div>
        </label>
      </section>

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
