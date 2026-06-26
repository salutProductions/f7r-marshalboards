use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{ContextMenu, Menu, MenuItem},
    AppHandle, Manager,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    websocket_url: String,
    browser_url: String,
    default_width: f64,
    default_height: f64,
    always_on_top: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            websocket_url: "wss://f7livemanager.salutproductionscontact.workers.dev/ws".into(),
            browser_url: "https://www.salutproductions.com/support-me".into(),
            default_width: 250.0,
            default_height: 150.0,
            always_on_top: true,
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

fn ensure_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;

    if !path.exists() {
        let config = AppConfig::default();
        let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
        fs::write(&path, text).map_err(|error| error.to_string())?;
        return Ok(config);
    }

    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn open_config_folder_impl(app: &AppHandle) -> Result<(), String> {
    let dir = config_dir(app)?;
    opener::open(dir).map_err(|error| error.to_string())
}

fn open_browser_url_impl(app: &AppHandle) -> Result<(), String> {
    let config = ensure_config(app)?;
    opener::open(config.browser_url).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    ensure_config(&app)
}

#[tauri::command]
fn open_config(app: AppHandle) -> Result<(), String> {
    open_config_folder_impl(&app)
}

#[tauri::command]
fn show_context_menu(window: tauri::Window) -> Result<(), String> {
    let open_browser =
        MenuItem::with_id(&window, "support", "Support the developer", true, None::<&str>)
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

    let menu = Menu::with_items(&window, &[&open_browser, &open_config_folder, &exit])
        .map_err(|error| error.to_string())?;

    menu.popup(window).map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            load_config
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "support" => {
                if let Err(error) = open_browser_url_impl(app) {
                    eprintln!("Failed to open browser URL: {error}");
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
