import { invoke } from "@tauri-apps/api/core";

export type AppConfig = {
  websocketUrl: string;
  defaultWidth: number;
  defaultHeight: number;
  alwaysOnTop: boolean;
  roundedCorners: boolean;
};

export async function loadConfig() {
  return invoke<AppConfig>("load_config");
}
