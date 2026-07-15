/*
 * Xcode 26 / iOS 26 SDK no longer ships libswiftCompatibility56 and
 * libswiftCompatibilityConcurrency for some platforms. Tauri's SwiftRs
 * static objects still emit force-load references to these symbols.
 *
 * Provide empty definitions so the final link succeeds when building with
 * the App Store-required iOS 26 SDK.
 */

__attribute__((used, visibility("default")))
const void *const __swift_FORCE_LOAD_$_swiftCompatibility56 = 0;

__attribute__((used, visibility("default")))
const void *const __swift_FORCE_LOAD_$_swiftCompatibilityConcurrency = 0;
