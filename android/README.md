# SHADY for Android

A thin Android app around the game: one full-screen WebView that shows the offline single-file
build (`npm run build:single` → `dist-single/index.html`) from the app's assets. The game code is the
web game, unchanged; saves live in the WebView's storage and survive updates.

## Install on a phone

1. On the phone, open <https://github.com/alnadel/NewGame/releases/tag/android-latest> and download
   `shady.apk`.
2. Open the download. Android asks to allow installs from your browser (or Files app) the first time:
   allow it, then tap **Install**.
3. Later builds install over it the same way; your progress stays.

The `Android` workflow (`.github/workflows/android.yml`) rebuilds and republishes that pre-release on
every push that touches the game or this folder.

## Build it yourself

Needs JDK 17+ and the Android SDK (Android Studio installs both).

```sh
npm ci
npm run build:single
gradle -p android assembleRelease        # or open android/ in Android Studio
# → android/app/build/outputs/apk/release/app-release.apk
```

`sideload.keystore` is a test key kept in the repo so every build updates the installed app. It is
not a store key: a Play Store release would need its own private key.
