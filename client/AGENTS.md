This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

This project uses **npm** (`package-lock.json`; no `bun.lock`). Use the scripts in `package.json`:

```bash
npm install
npm start                   # start the dev server
npm test                    # Jest
npm test -- tests/nav/geo.test.ts   # one test file
npm run typecheck           # tsc --noEmit
npm run lint                # eslint .
npm run web                 # browser UI (no BLE/map)
npx expo install <package>  # ALWAYS for native deps — resolves SDK-compatible versions
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- The app has **no router**: `src/screens/RootNavigator.tsx` renders a custom bottom-tab shell (`Карта / Ассистент / Очки`) that keeps all three screens mounted and hides inactive ones with opacity, disabled pointer events, and hidden accessibility elements. Do not use `display: none` here: native map markers disappear after the map is shown again. `src/screens/tabContext.ts` exports `useRootTab()` for cross-screen navigation. Do not add `expo-router`, `src/app/`, or React Navigation.
- The UI kit lives in `src/ui/` (theme tokens in `src/ui/theme.ts`, icons in `src/ui/Icon.tsx`). Screens use only these components, not ad-hoc inline styles.
- Native map taps select the exact pressed coordinate. `NavigationScreen` reverse-geocodes it through the server and `MapSelectionCard` builds a route via `chooseDestination`; a reverse result may supply the name but must not replace the pressed coordinates. Keep selection markers separate from current position and destination markers. The web map remains a static placeholder.

## Native builds

- There is no `eas.json` in this repo. Build locally with `npx expo prebuild` and `npm run ios` / `npm run android`.
- `ios/` is checked-in prebuild output; `android/` is not generated yet. Never hand-edit generated native folders — configure `app.json` and config plugins.

## Rules

- Expo Go only includes its bundled native modules. This app needs a dev client (`expo-dev-client`): after adding a native library, rebuild with `npx expo run:ios|android`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
