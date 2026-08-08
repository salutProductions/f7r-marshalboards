use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{CheckMenuItem, ContextMenu, Menu, MenuItem},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    websocket_url: String,
    default_width: f64,
    default_height: f64,
    always_on_top: bool,
    #[serde(default = "default_rounded_corners")]
    rounded_corners: bool,
    #[serde(default = "default_audio_enabled")]
    audio_enabled: bool,
    #[serde(default = "default_audio_volume")]
    audio_volume: f64,
}

fn default_rounded_corners() -> bool {
    true
}

fn default_audio_enabled() -> bool {
    true
}

const MAX_AUDIO_VOLUME: f64 = 3.0;

fn default_audio_volume() -> f64 {
    1.0
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            websocket_url: "wss://f7flags.saluthostedthis.tech/ws".into(),
            default_width: 220.0,
            default_height: 90.0,
            always_on_top: true,
            rounded_corners: default_rounded_corners(),
            audio_enabled: default_audio_enabled(),
            audio_volume: default_audio_volume(),
        }
    }
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("config.json"))
}

fn add_missing_defaults(config: &mut serde_json::Value, defaults: &serde_json::Value) -> bool {
    let (Some(config), Some(defaults)) = (config.as_object_mut(), defaults.as_object()) else {
        return false;
    };

    let mut changed = false;

    for (key, default_value) in defaults {
        match config.get_mut(key) {
            Some(config_value) => {
                changed |= add_missing_defaults(config_value, default_value);
            }
            None => {
                config.insert(key.clone(), default_value.clone());
                changed = true;
            }
        }
    }

    changed
}

fn ensure_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;

    if !path.exists() {
        let config = AppConfig::default();
        let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
        fs::write(&path, text).map_err(|error| error.to_string())?;
        return Ok(config);
    }

    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let text = text.trim_start_matches('\u{feff}');
    let mut value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| error.to_string())?;
    let defaults = serde_json::to_value(AppConfig::default()).map_err(|error| error.to_string())?;

    if add_missing_defaults(&mut value, &defaults) {
        let migrated = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
        fs::write(&path, migrated).map_err(|error| error.to_string())?;
    }

    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn open_config_folder_impl(app: &AppHandle) -> Result<(), String> {
    let dir = config_dir(app)?;
    opener::open(dir).map_err(|error| error.to_string())
}

fn open_browser_url_impl() -> Result<(), String> {
    opener::open("https://github.com/salutproductions/f7r-marshalboards")
        .map_err(|error| error.to_string())
}

fn open_settings_window_impl(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        return window.set_focus().map_err(|error| error.to_string());
    }

    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("Settings")
        .inner_size(420.0, 560.0)
        .min_inner_size(360.0, 420.0)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    ensure_config(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, mut config: AppConfig) -> Result<(), String> {
    if config.websocket_url.trim().is_empty() {
        return Err("WebSocket URL cannot be empty".into());
    }

    config.audio_volume = config.audio_volume.clamp(0.0, MAX_AUDIO_VOLUME);
    config.default_width = config.default_width.max(170.0);
    config.default_height = config.default_height.max(70.0);

    let path = config_path(&app)?;
    let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(config.always_on_top);
    }

    app.emit("config-updated", &config)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_config(app: AppHandle) -> Result<(), String> {
    open_config_folder_impl(&app)
}

#[tauri::command]
fn show_context_menu(window: tauri::Window, audio_enabled: bool) -> Result<(), String> {
    let open_browser = MenuItem::with_id(&window, "repo", "GitHub Repository", true, None::<&str>)
        .map_err(|error| error.to_string())?;

    let toggle_audio = CheckMenuItem::with_id(
        &window,
        "toggle-audio",
        "Audio callouts",
        true,
        audio_enabled,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;

    let settings = MenuItem::with_id(&window, "settings", "Settings...", true, None::<&str>)
        .map_err(|error| error.to_string())?;

    let open_config_folder = MenuItem::with_id(
        &window,
        "open-config",
        "Open config folder",
        true,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;

    let exit = MenuItem::with_id(&window, "exit", "Exit", true, None::<&str>)
        .map_err(|error| error.to_string())?;

    let menu = Menu::with_items(
        &window,
        &[
            &open_browser,
            &toggle_audio,
            &settings,
            &open_config_folder,
            &exit,
        ],
    )
    .map_err(|error| error.to_string())?;

    menu.popup(window).map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            match ensure_config(app.handle()) {
                Ok(config) => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: config.default_width,
                            height: config.default_height,
                        }));

                        let _ = window.set_always_on_top(config.always_on_top);
                    }
                }
                Err(error) => {
                    eprintln!("Failed to load config: {error}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_context_menu,
            open_config,
            load_config,
            save_config
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "repo" => {
                if let Err(error) = open_browser_url_impl() {
                    eprintln!("Failed to open browser URL: {error}");
                }
            }
            "toggle-audio" => {
                if let Err(error) = app.emit("toggle-audio", ()) {
                    eprintln!("Failed to emit toggle-audio: {error}");
                }
            }
            "settings" => {
                if let Err(error) = open_settings_window_impl(app) {
                    eprintln!("Failed to open settings window: {error}");
                }
            }
            "open-config" => {
                if let Err(error) = open_config_folder_impl(app) {
                    eprintln!("Failed to open config folder: {error}");
                }
            }
            "exit" => {
                app.exit(0);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
