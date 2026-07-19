import { invoke } from "@tauri-apps/api/core";

export type AppConfig = {
  websocketUrl: string;
  defaultWidth: number;
  defaultHeight: number;
  alwaysOnTop: boolean;
  roundedCorners: boolean;
  audioEnabled: boolean;
  audioVolume: number;
};

export async function loadConfig() {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig) {
  return invoke<void>("save_config", { config });
}
