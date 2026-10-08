# HelloHR mobile app (Android + iOS)

A Capacitor shell that opens the live HelloHR employee portal (https://hellohr24.vercel.app, set in `capacitor.config.json`) as a native app,
so every update to the website reaches the app immediately. The same code also installs as a home-screen app straight from the website (PWA).

## Android APK
GitHub: **Actions → "Build Android app (APK)" → Run workflow**, then download the `hellohr-apk` artifact.
Put the file at `public/downloads/hellohr.apk` and redeploy: the **Android** button on the login page then downloads it directly.
(Debug-signed APKs install on any phone after allowing "Install unknown apps". For the Play Store, make a release build signed with your own keystore.)

Locally (needs JDK 17 + Android SDK): `cd mobile && npm install && npx cap add android && npx cap sync && cd android && ./gradlew assembleDebug`.
Add `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` and `CAMERA` to `AndroidManifest.xml` (the workflow does this automatically) so punch-in location works.

## iOS
Apple only allows installing native iOS apps through the App Store or TestFlight, which needs a macOS computer with Xcode and an Apple Developer account (99 USD/year).
`cd mobile && npm install && npx cap add ios && npx cap sync ios && npx cap open ios`, add the location usage description
(`NSLocationWhenInUseUsageDescription`) to `Info.plist`, then archive and upload from Xcode.
Until then the **iOS** button on the login page shows how to add the site to the home screen from Safari, which works today on every iPhone.
