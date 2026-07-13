// JNI entry point. On DllMain-equivalent (JNI_OnLoad), fires the whole init:
// resolve Roblox base, install anti-detection, patch identity check, hook
// TaskScheduler::step, capture lua_State, install executor + Roblox globals.
#include <jni.h>
#include <pthread.h>
#include <unistd.h>
#include <string.h>
#include <android/log.h>
#include "native_shim.h"
#include "hooks_android.h"

#define LOG_TAG "RobloxMod"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

static JavaVM* g_jvm = NULL;
extern "C" JavaVM* rbxmod_jvm(void) { return g_jvm; }

static void* init_thread(void*) {
    // Wait until Roblox has loaded its native lib. Roblox's Java layer
    // System.loadLibrary("roblox") happens on splash; we may attach earlier.
    for (int i = 0; i < 300; i++) {
        rbx_find_base();
        if (g_roblox_base) break;
        usleep(100 * 1000);
    }
    if (!g_roblox_base) {
        __android_log_print(ANDROID_LOG_ERROR, LOG_TAG,
            "libroblox base not found in 30s — bailing");
        return NULL;
    }

    antidetect_install();
    mod_bypass_identity();
    mod_install_lua_bridge();
    mod_install_walkspeed_patch();
    mod_install_scheduler_hook();
    // Overlay is Java-side; kicked from RobloxMod.installOverlay() via JNI.
    LOGI("init sequence complete");
    return NULL;
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    g_jvm = vm;
    LOGI("JNI_OnLoad — spawning init thread");
    pthread_t t;
    pthread_create(&t, NULL, init_thread, NULL);
    pthread_detach(t);
    return JNI_VERSION_1_6;
}

// Invoked from Java when the user taps Execute in the overlay.
extern "C" JNIEXPORT void JNICALL
Java_com_bytemod_robloxmod_RobloxMod_execute(JNIEnv* env, jclass, jstring src) {
    const char* c = env->GetStringUTFChars(src, NULL);
    if (c) {
        mod_execute_script(c, strlen(c));
        env->ReleaseStringUTFChars(src, c);
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_bytemod_robloxmod_RobloxMod_setWalkSpeed(JNIEnv*, jclass, jfloat v) {
    mod_set_walkspeed(v);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bytemod_robloxmod_RobloxMod_setFly(JNIEnv*, jclass, jboolean on) {
    mod_set_fly(on);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bytemod_robloxmod_RobloxMod_setNoclip(JNIEnv*, jclass, jboolean on) {
    mod_set_noclip(on);
}
