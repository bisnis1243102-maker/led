#include <string.h>
#include <dlfcn.h>
#include "luau_shim.h"

extern "C" {
    extern uintptr_t g_off_lua_state_namecall;
    extern uintptr_t g_off_tstring_data;
    extern uintptr_t g_off_lua_state_global;
    extern uintptr_t g_off_global_allgcopages;
    extern uintptr_t g_off_gco_next;
    extern uintptr_t g_off_gco_tt;
}

static void* rbx_instance(lua_State* S, int i) {
    if (L.type(S, i) != LUA_TUSERDATA) return NULL;
    void* ud = L.touserdata(S, i);
    return ud ? *(void**)ud : NULL;
}

typedef void (*fire_t)(void*, void*, int);
static fire_t p_fire = NULL;

static int rx_fireclickdetector(lua_State* S) {
    void* inst = rbx_instance(S, 1);
    if (!inst) { L.pushnil(S); return 1; }
    if (!p_fire) p_fire = (fire_t)dlsym(RTLD_DEFAULT, "_ZN3RBX6Signal4FireEPvi");
    if (!p_fire) { L.pushboolean(S, 0); return 1; }
    void* sig = *(void**)((uint8_t*)inst + 0x60);
    p_fire(sig, NULL, 0);
    L.pushboolean(S, 1);
    return 1;
}

static int rx_getnamecallmethod(lua_State* S) {
    if (g_off_lua_state_namecall && g_off_tstring_data) {
        void* ts = *(void**)((uint8_t*)S + g_off_lua_state_namecall);
        if (!ts) { L.pushnil(S); return 1; }
        L.pushstring(S, (const char*)((uint8_t*)ts + g_off_tstring_data));
        return 1;
    }
    L.pushnil(S); return 1;
}

static int rx_getgc(lua_State* S) {
    int include_tables = L.toboolean(S, 1);
    L.createtable(S, 256, 0);
    int out = L.gettop(S);
    int n = 1;
    if (g_off_lua_state_global && g_off_global_allgcopages) {
        void* g = *(void**)((uint8_t*)S + g_off_lua_state_global);
        void* page = *(void**)((uint8_t*)g + g_off_global_allgcopages);
        int safety = 1 << 20;
        while (page && safety--) {
            uint8_t tt = *((uint8_t*)page + g_off_gco_tt);
            bool want = (tt==LUA_TFUNCTION) || (tt==LUA_TUSERDATA) ||
                        (include_tables && tt==LUA_TTABLE);
            if (want) {
                L.pushlightuserdata(S, page);
                L.rawseti(S, out, n++);
            }
            page = *(void**)((uint8_t*)page + g_off_gco_next);
        }
    }
    return 1;
}

extern "C" void roblox_globals_install(lua_State* S) {
    struct { const char* n; lua_CFunction f; } r[] = {
        {"fireclickdetector", rx_fireclickdetector},
        {"getnamecallmethod", rx_getnamecallmethod},
        {"getgc",             rx_getgc},
        {NULL, NULL}
    };
    for (int i = 0; r[i].n; i++) {
        L.pushcclosurek(S, r[i].f, r[i].n, 0, NULL);
        lua_setglobal(S, r[i].n);
    }
}
