/*
 * Xcode 26 does not ship libswiftCompatibility56 / Concurrency for some
 * platforms. Tauri SwiftRs objects still reference these force-load symbols.
 *
 * On Darwin, C identifiers get an extra leading underscore when mangled, so we
 * use explicit asm labels for the exact linker symbol names that libapp.a wants:
 *   __swift_FORCE_LOAD_$_swiftCompatibility56
 *   __swift_FORCE_LOAD_$_swiftCompatibilityConcurrency
 */

__attribute__((used, visibility("default")))
const void *const nostria_swift_force_load_compat56
    __asm__("__swift_FORCE_LOAD_$_swiftCompatibility56") = 0;

__attribute__((used, visibility("default")))
const void *const nostria_swift_force_load_compat_concurrency
    __asm__("__swift_FORCE_LOAD_$_swiftCompatibilityConcurrency") = 0;

__attribute__((used, visibility("default")))
const void *const nostria_swift_force_load_compat_packs
    __asm__("__swift_FORCE_LOAD_$_swiftCompatibilityPacks") = 0;
