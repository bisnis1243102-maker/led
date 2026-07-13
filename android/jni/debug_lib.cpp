#include <string.h>
#include "luau_shim.h"

extern "C" {
    extern uintptr_t g_off_closure_isC;
    extern uintptr_t g_off_closure_nup;
    extern uintptr_t g_off_closure_l_p;
    extern uintptr_t g_off_tstring_data;
}
extern "C" uintptr_t g_off_proto_k     = 0x18;
extern "C" uintptr_t g_off_proto_sizek = 0x60;
extern "C" uintptr_t g_off_proto_p     = 0x20;
extern "C" uintptr_t g_off_proto_sizep = 0x64;

static void* closure_proto(lua_State* S, int idx) {
    if (L.type(S, idx) != LUA_TFUNCTION) return NULL;
    void* cl = (void*)L.topointer(S, idx);
    if (!cl || *((uint8_t*)cl + g_off_closure_isC)) return NULL;
    return *(void**)((uint8_t*)cl + g_off_closure_l_p);
}
static int dbg_getconstants(lua_State* S) {
    void* p = closure_proto(S, 1);
    if (!p) { L.createtable(S, 0, 0); return 1; }
    int n = *(int*)((uint8_t*)p + g_off_proto_sizek);
    void* k = *(void**)((uint8_t*)p + g_off_proto_k);
    L.createtable(S, n, 0);
    for (int i = 0; i < n; i++) {
        uint8_t tt = *((uint8_t*)k + i*16 + 8);
        if (tt==LUA_TNUMBER) L.pushnumber(S, *(double*)((uint8_t*)k + i*16));
        else if (tt==LUA_TSTRING) {
            void* ts = *(void**)((uint8_t*)k + i*16);
            L.pushstring(S, (const char*)((uint8_t*)ts + g_off_tstring_data));
        } else if (tt==LUA_TBOOLEAN) L.pushboolean(S, *(int*)((uint8_t*)k + i*16));
        else L.pushnil(S);
        L.rawseti(S, -2, i+1);
    }
    return 1;
}
static int dbg_getupvalues(lua_State* S) {
    int n = 0;
    void* cl = (void*)L.topointer(S, 1);
    if (cl) n = *((uint8_t*)cl + g_off_closure_nup);
    L.createtable(S, n, 0);
    for (int i = 1; i <= n; i++) { L.pushnil(S); L.rawseti(S, -2, i); }
    return 1;
}

extern "C" void debug_lib_install(lua_State* S) {
    lua_getglobal(S, "debug");
    if (L.type(S, -1) != LUA_TTABLE) {
        lua_pop(S, 1);
        L.createtable(S, 0, 8);
        L.pushvalue(S, -1);
        lua_setglobal(S, "debug");
    }
    L.pushcclosurek(S, dbg_getconstants, "getconstants", 0, NULL);
    L.setfield(S, -2, "getconstants");
    L.pushcclosurek(S, dbg_getupvalues, "getupvalues", 0, NULL);
    L.setfield(S, -2, "getupvalues");
    lua_pop(S, 1);
}
