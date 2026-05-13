# NoQx Student — Android ProGuard / R8 rules

# Keep Capacitor bridge intact
-keep class com.getcapacitor.** { *; }
-keep class com.noqx.student.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.* <methods>;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin *;
}

# WebView JS bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve stack traces for crash reporting
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Firebase / Push notifications
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Kotlin
-keepclassmembernames class kotlinx.** { volatile <fields>; }
-dontwarn kotlin.**

# OkHttp (used by Capacitor internally)
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }
