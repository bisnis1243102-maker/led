#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lua_State lua_State;

struct RobloxOffsets {
    uintptr_t lua_newstate;
    uintptr_t lua_pcall;
    uintptr_t luaL_loadbuffer;
    uintptr_t task_scheduler_step;
    uintptr_t humanoid_setstate;
    uintptr_t identity_check;
    uintptr_t luau_compile;
};
extern struct RobloxOffsets g_off;

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

void mod_bypass_identity(void);
void mod_install_lua_bridge(void);
void mod_install_walkspeed_patch(void);
void mod_install_scheduler_hook(void);
void mod_execute_script(const char* src, size_t len);
void mod_set_walkspeed(float);
void mod_set_fly(bool);
void mod_set_noclip(bool);

// implemented in Lua-side TUs
void executor_install(lua_State*);
void executor_mark_thread(lua_State*);
void roblox_globals_install(lua_State*);
void debug_lib_install(lua_State*);
void crypt_lib_install(lua_State*);
void sched_set_main(lua_State*);
void sched_execute(const char*, size_t);
void sched_tick(void);
void autoexec_run(void);

#ifdef __cplusplus
}
#endif
