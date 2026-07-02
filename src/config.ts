import { invoke } from "@tauri-apps/api/core";

export type CarCategory = "GT3" | "HYPERCAR";

export type AppConfig = {
  websocketUrl: string;
  defaultWidth: number;
  defaultHeight: number;
  alwaysOnTop: boolean;
  carCategory: CarCategory;
};

export async function loadConfig() {
  return invoke<AppConfig>("load_config");
}
