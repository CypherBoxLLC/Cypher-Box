# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.sifir.** { *;}
-keep interface com.sifir.** { *;}
-keep enum com.sifir.** { *;}
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- R8 on release builds ---------------------------------------------------
# Classes some libraries reference but that are not in the app:
# - react-native-camera's ML Kit barcode and face code points at older ML Kit
#   classes than the ones the app ships; that code would fail the same way
#   without R8.
# - Samsung Pass (pulled in by FingerprintIdentify, react-native-fingerprint-
#   scanner) talks to Samsung's own fingerprint service, which exists only on
#   Samsung phones.
-dontwarn com.google.mlkit.vision.barcode.Barcode
-dontwarn com.google.mlkit.vision.common.internal.Detector
-dontwarn com.samsung.android.fingerprint.**
# Samsung Pass implements callbacks of that service. R8 cannot see the service's
# classes, so it cannot tell which methods the system calls by name: keep the
# SDK whole.
-keep class com.samsung.android.sdk.pass.** { *; }
# Realm's native library (librealm.so) looks up io.realm.react.util.SSLHelper by
# name while it loads; no Java code refers to it, so R8 removed it and the app
# crashed at start. Realm ships no rules of its own.
-keep class io.realm.react.** { *; }
# React Native 0.77's native code looks these classes up by name, and RN's own
# rules don't keep them: ReactModalHostView sizes every Modal (opening one
# crashed with ClassNotFoundException), and the debugger's websocket interface
# is used by the inspector.
-keep class com.facebook.react.views.modal.** { *; }
-keep class com.facebook.react.devsupport.CxxInspectorPackagerConnection** { *; }
