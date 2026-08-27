use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    menu::{CheckMenuItem, ContextMenu, Menu, MenuItem},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tokio::{net::TcpListener, sync::broadcast};
use tokio_tungstenite::{accept_async, tungstenite::Message};

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
    #[serde(default = "default_transparency")]
    transparency: bool,
    #[serde(default = "default_audio_volume")]
    audio_volume: f64,
    #[serde(default)]
    simhub_relay_enabled: bool,
    #[serde(default = "default_simhub_relay_port")]
    simhub_relay_port: u16,
}

fn default_rounded_corners() -> bool {
    true
}

fn default_audio_enabled() -> bool {
    true
}

fn default_transparency() -> bool {
    false
}

const MAX_AUDIO_VOLUME: f64 = 3.0;

fn default_audio_volume() -> f64 {
    1.0
}

fn default_simhub_relay_port() -> u16 {
    43820
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            websocket_url: "wss://f7flags.saluthostedthis.tech/ws".into(),
            default_width: 220.0,
            default_height: 90.0,
            always_on_top: true,
            transparency: default_transparency(),
            rounded_corners: default_rounded_corners(),
            audio_enabled: default_audio_enabled(),
            audio_volume: default_audio_volume(),
            simhub_relay_enabled: false,
            simhub_relay_port: default_simhub_relay_port(),
        }
    }
}

struct SimhubRelay {
    enabled: AtomicBool,
    latest: Mutex<String>,
    updates: broadcast::Sender<String>,
}

impl SimhubRelay {
    fn new() -> Self {
        let (updates, _) = broadcast::channel(16);
        Self {
            enabled: AtomicBool::new(false),
            latest: Mutex::new(r#"{"version":1,"state":"NOTHING"}"#.into()),
            updates,
        }
    }

    fn publish(
        &self,
        signal: String,
        remaining_seconds: Option<u32>,
        countdown_seconds: Option<u32>,
    ) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        let payload = serde_json::json!({
            "version": 1,
            "state": signal,
            "remainingSeconds": remaining_seconds,
            "countdownSeconds": countdown_seconds,
        })
        .to_string();
        if let Ok(mut latest) = self.latest.lock() {
            *latest = payload.clone();
        }
        let _ = self.updates.send(payload);
    }
}

async fn run_simhub_relay(relay: Arc<SimhubRelay>, port: u16) {
    let listener = match TcpListener::bind(("127.0.0.1", port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Unable to start SimHub relay on port {port}: {error}");
            return;
        }
    };

    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let relay = relay.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(mut socket) = accept_async(stream).await else {
                return;
            };
            if relay.enabled.load(Ordering::Relaxed) {
                let snapshot = relay
                    .latest
                    .lock()
                    .map(|value| value.clone())
                    .unwrap_or_default();
                if socket.send(Message::Text(snapshot.into())).await.is_err() {
                    return;
                }
            }
            let mut updates = relay.updates.subscribe();
            loop {
                tokio::select! {
                    update = updates.recv() => match update {
                        Ok(payload) => if socket.send(Message::Text(payload.into())).await.is_err() { return; },
                        Err(_) => return,
                    },
                    incoming = socket.next() => match incoming {
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                        _ => {},
                    },
                }
            }
        });
    }
}

async fn run_simhub_heartbeat(relay: Arc<SimhubRelay>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
    loop {
        interval.tick().await;
        if !relay.enabled.load(Ordering::Relaxed) {
            continue;
        }

        let payload = relay
            .latest
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default();
        let heartbeat = format!("{},\"heartbeat\":true}}", payload.trim_end_matches('}'));
        let _ = relay.updates.send(heartbeat);
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
    let mut config = ensure_config(&app)?;
    config.transparency = false;
    Ok(config)
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    relay: tauri::State<'_, Arc<SimhubRelay>>,
    mut config: AppConfig,
) -> Result<(), String> {
    if config.websocket_url.trim().is_empty() {
        return Err("WebSocket URL cannot be empty".into());
    }

    config.audio_volume = config.audio_volume.clamp(0.0, MAX_AUDIO_VOLUME);
    config.default_width = config.default_width.max(170.0);
    config.default_height = config.default_height.max(70.0);
    if config.simhub_relay_port < 1024 {
        return Err("SimHub relay port must be between 1024 and 65535".into());
    }

    let path = config_path(&app)?;
    let mut stored_config = config.clone();
    stored_config.transparency = false;
    let text = serde_json::to_string_pretty(&stored_config).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(config.always_on_top);
    }

    relay
        .enabled
        .store(config.simhub_relay_enabled, Ordering::Relaxed);
    if !config.simhub_relay_enabled {
        relay.publish("NOTHING".into(), None, None);
    }

    app.emit("config-updated", &config)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_config(app: AppHandle) -> Result<(), String> {
    open_config_folder_impl(&app)
}

fn simhub_install_dir() -> Option<PathBuf> {
    ["ProgramFiles(x86)", "ProgramFiles"]
        .iter()
        .filter_map(|name| env::var_os(name))
        .map(PathBuf::from)
        .map(|path| path.join("SimHub"))
        .find(|path| path.is_dir())
}

#[tauri::command]
fn install_simhub_plugin(app: AppHandle) -> Result<String, String> {
    let source = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("plugins")
        .join("MarshalBoards LED.dll");

    if !source.is_file() {
        return Err("The bundled SimHub plugin could not be found.".into());
    }

    let destination_dir = simhub_install_dir()
        .ok_or_else(|| "SimHub was not found in the standard installation folders.".to_string())?;
    let destination = destination_dir.join("MarshalBoards LED.dll");

    fs::copy(&source, &destination).map_err(|error| {
        format!(
            "Could not install the plugin. Close SimHub and run MarshalBoards as administrator if the folder is protected: {error}"
        )
    })?;

    Ok(destination.display().to_string())
}

#[tauri::command]
fn publish_simhub_state(
    relay: tauri::State<'_, Arc<SimhubRelay>>,
    signal: String,
    remaining_seconds: Option<u32>,
    countdown_seconds: Option<u32>,
) {
    relay.publish(signal, remaining_seconds, countdown_seconds);
}

#[tauri::command]
fn show_context_menu(
    window: tauri::Window,
    audio_enabled: bool,
    transparency_enabled: bool,
) -> Result<(), String> {
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

    let toggle_transparency = CheckMenuItem::with_id(
        &window,
        "toggle-transparency",
        "Transparency",
        true,
        transparency_enabled,
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
            &toggle_transparency,
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
    let relay = Arc::new(SimhubRelay::new());
    let relay_server = relay.clone();
    let relay_heartbeat = relay.clone();
    tauri::Builder::default()
        .manage(relay)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            match ensure_config(app.handle()) {
                Ok(config) => {
                    app.state::<Arc<SimhubRelay>>()
                        .enabled
                        .store(config.simhub_relay_enabled, Ordering::Relaxed);
                    let relay_port = config.simhub_relay_port;

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: config.default_width,
                            height: config.default_height,
                        }));

                        let _ = window.set_always_on_top(config.always_on_top);
                    }

                    tauri::async_runtime::spawn(run_simhub_relay(relay_server.clone(), relay_port));
                }
                Err(error) => {
                    eprintln!("Failed to load config: {error}");
                }
            }

            tauri::async_runtime::spawn(run_simhub_heartbeat(relay_heartbeat.clone()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_context_menu,
            open_config,
            load_config,
            save_config,
            publish_simhub_state,
            install_simhub_plugin
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
            "toggle-transparency" => {
                if let Err(error) = app.emit("toggle-transparency", ()) {
                    eprintln!("Failed to emit toggle-transparency: {error}");
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
