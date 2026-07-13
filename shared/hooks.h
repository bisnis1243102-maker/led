#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Roblox iOS client — Lua state / TaskScheduler / Humanoid hook surface.
// Offsets are version-tied; see patcher/offsets.py for the current release.

typedef struct lua_State lua_State;
typedef int (*lua_CFunction)(lua_State*);

struct RobloxOffsets {
    uintptr_t lua_newstate;
    uintptr_t lua_pcall;
    uintptr_t luaL_loadbuffer;
    uintptr_t task_scheduler_step;
    uintptr_t humanoid_setstate;
    uintptr_t datamodel_open;
    uintptr_t script_context_resume;
    uintptr_t print_hook;
    uintptr_t identity_check;
};

extern struct RobloxOffsets g_off;

// Luau internal struct offsets — consumed by executor_lib.mm
extern uintptr_t g_off_lua_state_namecall;
extern uintptr_t g_off_lua_state_global;
extern uintptr_t g_off_global_allgcopages;
extern uintptr_t g_off_gco_next;
extern uintptr_t g_off_gco_tt;
extern uintptr_t g_off_tstring_data;
extern uintptr_t g_off_closure_isC;
extern uintptr_t g_off_closure_nup;
extern uintptr_t g_off_closure_l_p;
extern uintptr_t g_off_closure_c_f;

void mod_init(void* image_base);
void mod_install_lua_bridge(void);
void mod_install_render_overlay(void);
void mod_install_walkspeed_patch(void);
void mod_install_jump_patch(void);
void mod_install_noclip(void);
void mod_install_fly(void);
void mod_execute_script(const char* src, size_t len);

uintptr_t rbx_slide(uintptr_t off);
void* rbx_resolve(const char* sym);

#ifdef __cplusplus
}
#endif
