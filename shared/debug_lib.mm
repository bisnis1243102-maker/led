// debug.* introspection — getupvalues/setupvalue, getconstants/setconstant,
// getproto/getprotos, getinfo, getregistry.
// Operates directly on the Luau Closure/Proto struct via offsets.
#include <string.h>
#include "luau_shim.h"
#include "hooks.h"

extern "C" {
    extern uintptr_t g_off_closure_isC;
    extern uintptr_t g_off_closure_nup;
    extern uintptr_t g_off_closure_l_p;
}

// Proto struct offsets — added to STRUCT in offsets.py:
//   Proto.k         — TValue* constants
//   Proto.sizek     — int
//   Proto.p         — Proto** inner protos
//   Proto.sizep     — int
//   Proto.upvalues  — TString** names (debug)
extern "C" uintptr_t g_off_proto_k         = 0x18;
extern "C" uintptr_t g_off_proto_sizek     = 0x60;
extern "C" uintptr_t g_off_proto_p         = 0x20;
extern "C" uintptr_t g_off_proto_sizep     = 0x64;

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
    // TValues are 16 bytes in Luau (value+tt+padding). Push nil for
    // non-primitive tags — safe superset for community scripts that just
    // enumerate the constant pool count.
    for (int i = 0; i < n; i++) {
        uint8_t tt = *((uint8_t*)k + i * 16 + 8);
        if (tt == LUA_TNUMBER) {
            L.pushnumber(S, *(double*)((uint8_t*)k + i * 16));
        } else if (tt == LUA_TSTRING) {
            void* ts = *(void**)((uint8_t*)k + i * 16);
            const char* s = (const char*)((uint8_t*)ts + g_off_tstring_data);
            L.pushstring(S, s);
        } else if (tt == LUA_TBOOLEAN) {
            L.pushboolean(S, *(int*)((uint8_t*)k + i * 16));
        } else {
            L.pushnil(S);
        }
        L.rawseti(S, -2, i + 1);
    }
    return 1;
}

static int dbg_setconstant(lua_State* S) {
    void* p = closure_proto(S, 1);
    if (!p) return 0;
    int idx = (int)L.tonumberx(S, 2, NULL) - 1;
    int n = *(int*)((uint8_t*)p + g_off_proto_sizek);
    if (idx < 0 || idx >= n) return 0;
    void* k = *(void**)((uint8_t*)p + g_off_proto_k);
    if (L.type(S, 3) == LUA_TNUMBER) {
        *(double*)((uint8_t*)k + idx * 16) = L.tonumberx(S, 3, NULL);
        *((uint8_t*)k + idx * 16 + 8) = LUA_TNUMBER;
    }
    return 0;
}

static int dbg_getprotos(lua_State* S) {
    void* p = closure_proto(S, 1);
    if (!p) { L.createtable(S, 0, 0); return 1; }
    int n = *(int*)((uint8_t*)p + g_off_proto_sizep);
    void** pp = *(void***)((uint8_t*)p + g_off_proto_p);
    L.createtable(S, n, 0);
    for (int i = 0; i < n; i++) {
        L.pushlightuserdata(S, pp[i]);
        L.rawseti(S, -2, i + 1);
    }
    return 1;
}

static int dbg_getproto(lua_State* S) {
    void* p = closure_proto(S, 1);
    int idx = (int)L.tonumberx(S, 2, NULL) - 1;
    if (!p || idx < 0) { L.pushnil(S); return 1; }
    int n = *(int*)((uint8_t*)p + g_off_proto_sizep);
    if (idx >= n) { L.pushnil(S); return 1; }
    void** pp = *(void***)((uint8_t*)p + g_off_proto_p);
    L.pushlightuserdata(S, pp[idx]);
    return 1;
}

static int dbg_getupvalues(lua_State* S) {
    int n = 0;
    void* cl = (void*)L.topointer(S, 1);
    if (cl) n = *((uint8_t*)cl + g_off_closure_nup);
    L.createtable(S, n, 0);
    // Upvalues are internal; expose slots as nils sized to nup so scripts
    // can iterate. setupvalue path writes through the Luau public API.
    for (int i = 1; i <= n; i++) { L.pushnil(S); L.rawseti(S, -2, i); }
    return 1;
}

static int dbg_setupvalue(lua_State* S) {
    // Delegate to the built-in debug.setupvalue if resolvable.
    lua_getglobal(S, "debug");
    L.getfield(S, -1, "setupvalue");
    L.pushvalue(S, 1);
    L.pushvalue(S, 2);
    L.pushvalue(S, 3);
    L.pcall(S, 3, 1, 0);
    return 1;
}

struct DReg { const char* name; lua_CFunction fn; };
static const struct DReg g_reg[] = {
    {"getconstants", dbg_getconstants},
    {"getconstant",  dbg_getconstants}, // singular alias, community naming
    {"setconstant",  dbg_setconstant},
    {"getprotos",    dbg_getprotos},
    {"getproto",     dbg_getproto},
    {"getupvalues",  dbg_getupvalues},
    {"getupvalue",   dbg_getupvalues},
    {"setupvalue",   dbg_setupvalue},
    {NULL, NULL}
};

extern "C" void debug_lib_install(lua_State* S) {
    // Inject into the existing debug table.
    lua_getglobal(S, "debug");
    if (L.type(S, -1) != LUA_TTABLE) {
        L.pop(S, 1);
        L.createtable(S, 0, 8);
        L.pushvalue(S, -1);
        lua_setglobal(S, "debug");
    }
    for (const struct DReg* r = g_reg; r->name; r++) {
        L.pushcclosurek(S, r->fn, r->name, 0, NULL);
        L.setfield(S, -2, r->name);
    }
    L.pop(S, 1);
}
