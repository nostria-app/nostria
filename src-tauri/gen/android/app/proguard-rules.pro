# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# The custom Android signer bridge exchanges JSON with the Rust side via Tauri.
# These DTOs are serialized/deserialized reflectively, so release obfuscation must
# preserve their field and method names.
-keep class no.brainbox.nostria.AndroidSignerPlugin { *; }
-keep class no.brainbox.nostria.AndroidSignerPermission { *; }
-keep class no.brainbox.nostria.GetPublicKeyArgs { *; }
-keep class no.brainbox.nostria.AndroidSignerCommandArgs { *; }
-keep class no.brainbox.nostria.AndroidSignerResponse { *; }
-keep class no.brainbox.nostria.AndroidSignerPublicKeyResponse { *; }