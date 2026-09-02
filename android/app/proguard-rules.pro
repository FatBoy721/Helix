# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# HiveMQ MQTT client (Bambu Lab LAN transport). It sits on Netty, which
# references optional native transports and JDK-only classes that do not exist
# on Android — R8 must not treat those as missing-class errors.
-dontwarn io.netty.**
-dontwarn com.hivemq.client.**
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-keep class io.netty.channel.socket.nio.** { *; }

# Add any project specific keep options here:
