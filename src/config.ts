import { invoke } from "@tauri-apps/api/core";

export type AppConfig = {
  websocketUrl: string;
  defaultWidth: number;
  defaultHeight: number;
  alwaysOnTop: boolean;
  roundedCorners: boolean;
  transparency: boolean;
  audioEnabled: boolean;
  audioVolume: number;
  simhubRelayEnabled: boolean;
  simhubRelayPort: number;
};

export async function loadConfig() {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig) {
  return invoke<void>("save_config", { config });
}
