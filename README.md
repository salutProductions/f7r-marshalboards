
<p align="left">
    <picture> 
      <source media="(prefers-color-scheme: dark)" srcset="https://f7assets.saluthostedthis.tech/mb.png">
      <source media="(prefers-color-scheme: light)" srcset="https://f7assets.saluthostedthis.tech/mblightmode.png">
      <img width=400 style="margin-top:1rem;">
    </picture>
</p>

# 
<p>
  <a href="https://www.gnu.org/licenses/agpl-3.0">
    <img alt="AGPL v3 License" src="https://img.shields.io/badge/License-AGPL_v3-blue.svg">
  </a>
  <a href="https://ko-fi.com/salutproductions">
    <img alt="Donate!" src="https://img.shields.io/badge/support%20me!-orange?style=flat&logo=ko-fi&label=ko-fi">
  </a>
</p>

MarshalBoards is a small, lightweight and compact Tauri app, that allows sim-racing leagues to easily implement Safety Car / Full-Course Yellow events in a Le Mans Ultimate race, by displaying the current-flag on a small resizable window on every driver's window. 

Originally made for F7R's Le Mans Ultimate division, made to be compatible with any other league.



## 💿 Installation

  Download the Windows portable executable (~8MB) from the [Releases Page](https://github.com/salutProductions/f7r-marshalboards/releases).

  Linux Support: *Coming Soon*
  <hr>
  #### 👩‍💻 Manual Source Building
  
  Source development & building requires:
   
   * [NodeJS/NPM](https://nodejs.org/en/download)
   * [Rust](https://rustup.rs/)
   * [C++ Build Tools](https://visualstudio.microsoft.com/downloads/?q=build+tools)

   After the above are installed, you can run the project locally via:

  ```
    npm install
    npm run tauri dev
  ```

  To build it:
  ```
    npm run tauri build
  ```

## 🏎 Usage


By default, the app automatically connects to F7's MarshalBoard's websocket. To configure it to your league, check the [configuration guide](https://github.com/salutProductions/f7r-marshalboards/blob/main/docs/LEAGUE.md). 
* Exclusive Fullscreen mode is **NOT** supported. Please use Windowed or Borderless Fullscreen. 
* VR Users can use this overlay app using apps like CrewChief.


## 📄 License

AGPL V3.
