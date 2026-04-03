import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val releaseKeystorePath = System.getenv("TAURI_ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("TAURI_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("TAURI_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("TAURI_ANDROID_KEY_PASSWORD")
val useDebugSigningForRelease = System.getenv("TAURI_ANDROID_RELEASE_USE_DEBUG_KEY")
    ?.let { it.equals("true", ignoreCase = true) || it == "1" }
    ?: false
val releaseSigningValues = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
)
val hasReleaseSigning = releaseSigningValues.all { !it.isNullOrBlank() }
val hasPartialReleaseSigning = releaseSigningValues.any { !it.isNullOrBlank() } && !hasReleaseSigning

if (hasPartialReleaseSigning) {
    throw GradleException(
        "Android release signing requires TAURI_ANDROID_KEYSTORE_PATH, TAURI_ANDROID_KEYSTORE_PASSWORD, TAURI_ANDROID_KEY_ALIAS, and TAURI_ANDROID_KEY_PASSWORD."
    )
}

android {
    compileSdk = 36
    namespace = "no.brainbox.nostria"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "no.brainbox.nostria"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword!!
                keyAlias = releaseKeyAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (useDebugSigningForRelease) {
                signingConfig = signingConfigs.getByName("debug")
            } else if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")