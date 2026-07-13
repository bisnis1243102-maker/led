// Port of shared/hooks.mm minus UIKit / mach. Same hook logic, POSIX flavored.
#include <string.h>
#include <stdlib.h>
#include <pthread.h>
#include <android/log.h>
#include "native_shim.h"
#include "hooks_android.h"

#define LOG_TAG "RobloxMod"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

struct RobloxOffsets g_off;
uintptr_t g_off_lua_state_namecall   = 0x60;
uintptr_t g_off_lua_state_global     = 0x18;
uintptr_t g_off_global_allgcopages   = 0x40;
uintptr_t g_off_gco_next             = 0x00;
uintptr_t g_off_gco_tt               = 0x08;
uintptr_t g_off_tstring_data         = 0x18;
uintptr_t g_off_closure_isC          = 0x0A;
uintptr_t g_off_closure_nup          = 0x0B;
uintptr_t g_off_closure_l_p          = 0x28;
uintptr_t g_off_closure_c_f          = 0x28;

typedef int (*luaL_loadbuffer_t)(lua_State*, const char*, size_t, const char*);
typedef int (*lua_pcall_t)(lua_State*, int, int, int);
typedef lua_State* (*newstate_t)(void*, void*);

static luaL_loadbuffer_t p_loadbuffer;
static lua_pcall_t       p_pcall;
static lua_State*        g_L = NULL;
static pthread_mutex_t   g_L_mtx = PTHREAD_MUTEX_INITIALIZER;

static newstate_t o_newstate;
static lua_State* h_newstate(void* a, void* b) {
    lua_State* L = o_newstate(a, b);
    pthread_mutex_lock(&g_L_mtx);
    if (!g_L) {
        g_L = L;
        executor_install(L);
        roblox_globals_install(L);
        debug_lib_install(L);
        crypt_lib_install(L);
        sched_set_main(L);
        autoexec_run();
        LOGI("captured lua_State=%p, installed libraries", L);
    }
    pthread_mutex_unlock(&g_L_mtx);
    return L;
}

void mod_install_lua_bridge(void) {
    if (!g_off.lua_newstate) return;
    p_loadbuffer = (luaL_loadbuffer_t)rbx_slide(g_off.luaL_loadbuffer);
    p_pcall      = (lua_pcall_t)rbx_slide(g_off.lua_pcall);
    o_newstate   = (newstate_t)rbx_slide(g_off.lua_newstate);
    rbx_hook_branch((void*)o_newstate, (void*)&h_newstate);
}

void mod_execute_script(const char* src, size_t len) {
    sched_execute(src, len);
}

void mod_bypass_identity(void) {
    if (!g_off.identity_check) return;
    uint32_t patch[2] = { 0x52800100, 0xD65F03C0 };  // MOV W0,#8 ; RET
    rbx_patch_bytes(rbx_slide(g_off.identity_check), patch, sizeof(patch));
}

// -- movement ----------------------------------------------------------------
static float g_walkspeed = 32.0f;
static float g_jumppower = 100.0f;
static bool  g_noclip    = false;
static bool  g_fly       = false;

typedef void (*humanoid_setstate_t)(void* self, int state);
static humanoid_setstate_t o_humanoid_setstate;

static void h_humanoid_setstate(void* self, int state) {
    if (g_fly) state = 4;
    o_humanoid_setstate(self, state);
    *(float*)((uint8_t*)self + 0x2A8) = g_walkspeed;
    *(float*)((uint8_t*)self + 0x2AC) = g_jumppower;
}

void mod_install_walkspeed_patch(void) {
    if (!g_off.humanoid_setstate) return;
    o_humanoid_setstate = (humanoid_setstate_t)rbx_slide(g_off.humanoid_setstate);
    rbx_hook_branch((void*)o_humanoid_setstate, (void*)&h_humanoid_setstate);
}

void mod_set_walkspeed(float v) { g_walkspeed = v; }
void mod_set_fly(bool on)       { g_fly = on; }
void mod_set_noclip(bool on)    { g_noclip = on; }

// -- TaskScheduler::step -----------------------------------------------------
typedef void (*step_t)(void* self);
static step_t o_step = NULL;
static void h_step(void* self) {
    o_step(self);
    sched_tick();
}
void mod_install_scheduler_hook(void) {
    if (!g_off.task_scheduler_step) return;
    o_step = (step_t)rbx_slide(g_off.task_scheduler_step);
    rbx_hook_branch((void*)o_step, (void*)&h_step);
}
