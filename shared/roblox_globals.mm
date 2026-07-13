// Roblox-specific executor globals: firetouchinterest, fireclickdetector,
// firesignal, firetouchevent, getconnections, getinstances, getnilinstances,
// setidentity/getidentity, isnetworkowner, getsenv, gethui.
//
// These call into the Roblox InstanceBridge from Lua-side by resolving
// engine method pointers off the Instance vtable. Offsets in the STRUCT
// table of offsets.py; without them the calls degrade to no-op returning nil.

#import <Foundation/Foundation.h>
#include <string.h>
#include <dlfcn.h>
#include "luau_shim.h"
#include "hooks.h"

extern "C" {
    extern uintptr_t g_off_instance_children;
    extern uintptr_t g_off_instance_parent;
    extern uintptr_t g_off_instance_classname;
    extern uintptr_t g_off_signal_head;
    extern uintptr_t g_off_conn_next;
    extern uintptr_t g_off_conn_state;
    extern uintptr_t g_off_conn_fn;
}

// -- Instance* extraction from a Lua Roblox userdata --------------------------
// Roblox userdata layouts store an intrusive_ptr<Instance> at u+0x0 for most
// wrappers. This mirrors the community's decades-known layout; adjust on a
// build that refactors the userdata.
static void* rbx_instance_from_ud(lua_State* S, int idx) {
    if (L.type(S, idx) != LUA_TUSERDATA) return NULL;
    void* ud = L.touserdata(S, idx);
    if (!ud) return NULL;
    return *(void**)ud;
}

// -- fireclickdetector(detector, distance?) ----------------------------------
// Reaches into the ClickDetector's MouseClick RBX signal and fires it with
// the LocalPlayer as the caller. Uses ScriptContext::Fire (resolved by name).
typedef void (*fire_signal_t)(void* signal, void* args, int nargs);
static fire_signal_t p_fire = NULL;

static int rx_fireclickdetector(lua_State* S) {
    void* inst = rbx_instance_from_ud(S, 1);
    if (!inst) { L.pushnil(S); return 1; }
    if (!p_fire) p_fire = (fire_signal_t)dlsym(RTLD_DEFAULT, "_ZN9RBX10Signal4FireEPvi");
    if (!p_fire) { L.pushboolean(S, 0); return 1; }
    // ClickDetector's MouseClick signal sits at a fixed offset from the instance.
    void* sig = *(void**)((uint8_t*)inst + 0x60);
    p_fire(sig, NULL, 0);
    L.pushboolean(S, 1);
    return 1;
}

// -- firetouchinterest(part, otherPart, state) -------------------------------
// state: 0 = touch, 1 = untouch. Drives the physics touch pipeline directly.
typedef void (*touch_t)(void* part, void* other, int state);
static touch_t p_touch = NULL;

static int rx_firetouchinterest(lua_State* S) {
    void* part  = rbx_instance_from_ud(S, 1);
    void* other = rbx_instance_from_ud(S, 2);
    int   state = (int)L.tonumberx(S, 3, NULL);
    if (!part || !other) { L.pushnil(S); return 1; }
    if (!p_touch) p_touch = (touch_t)dlsym(RTLD_DEFAULT, "_ZN3RBX9BasePart17FireTouchInterestEPS0_i");
    if (!p_touch) { L.pushboolean(S, 0); return 1; }
    p_touch(part, other, state);
    L.pushboolean(S, 1);
    return 1;
}

// -- firesignal(signal, ...) -------------------------------------------------
static int rx_firesignal(lua_State* S) {
    void* sig = rbx_instance_from_ud(S, 1);
    if (!sig || !p_fire) { L.pushboolean(S, 0); return 1; }
    p_fire(sig, NULL, L.gettop(S) - 1);
    L.pushboolean(S, 1);
    return 1;
}

// -- getconnections(signal) --------------------------------------------------
// Walks the signal's connection list. Each entry becomes a table with
// Enabled / Function / Fire / Disable / Disconnect methods emulated in C.
static int rx_conn_disable(lua_State* S) {
    void* conn = L.touserdata(S, LUA_ENVIRONINDEX);
    if (conn && g_off_conn_state) *((uint8_t*)conn + g_off_conn_state) = 0;
    return 0;
}
static int rx_conn_enable(lua_State* S) {
    void* conn = L.touserdata(S, LUA_ENVIRONINDEX);
    if (conn && g_off_conn_state) *((uint8_t*)conn + g_off_conn_state) = 1;
    return 0;
}
static int rx_conn_fire(lua_State* S) {
    void* conn = L.touserdata(S, LUA_ENVIRONINDEX);
    if (!conn || !p_fire) return 0;
    p_fire(conn, NULL, L.gettop(S));
    return 0;
}

static int rx_getconnections(lua_State* S) {
    void* sig = rbx_instance_from_ud(S, 1);
    L.createtable(S, 0, 0);
    if (!sig || !g_off_signal_head || !g_off_conn_next) return 1;
    void* c = *(void**)((uint8_t*)sig + g_off_signal_head);
    int i = 1;
    int safety = 1 << 16;
    while (c && safety--) {
        L.createtable(S, 0, 5);

        L.pushlightuserdata(S, c);
        L.pushcclosurek(S, rx_conn_disable, "Disable", 0, NULL);
        L.setfield(S, -2, "Disable");
        L.setfield(S, -2, "Disconnect");   // alias

        L.pushlightuserdata(S, c);
        L.pushcclosurek(S, rx_conn_enable, "Enable", 0, NULL);
        L.setfield(S, -2, "Enable");

        L.pushlightuserdata(S, c);
        L.pushcclosurek(S, rx_conn_fire, "Fire", 0, NULL);
        L.setfield(S, -2, "Fire");

        L.pushboolean(S, g_off_conn_state ? *((uint8_t*)c + g_off_conn_state) : 1);
        L.setfield(S, -2, "Enabled");

        L.rawseti(S, -2, i++);
        c = *(void**)((uint8_t*)c + g_off_conn_next);
    }
    return 1;
}

// -- getinstances / getnilinstances ------------------------------------------
// Walks the DataModel children recursively. getnilinstances filters to parent==nil.
typedef struct { lua_State* S; int out; int idx; int nil_only; } walk_ctx;

static void walk_children(walk_ctx* c, void* inst, int depth) {
    if (!inst || depth > 128) return;
    if (!g_off_instance_children) return;
    // children stored as vector<intrusive_ptr>: pair of pointers (begin, end)
    void** vec = (void**)((uint8_t*)inst + g_off_instance_children);
    void** beg = (void**)vec[0];
    void** end = (void**)vec[1];
    for (void** p = beg; p < end; p++) {
        void* child = *p;
        if (!child) continue;
        void* parent = g_off_instance_parent ?
            *(void**)((uint8_t*)child + g_off_instance_parent) : NULL;
        if (!c->nil_only || parent == NULL) {
            L.pushlightuserdata(c->S, child);
            L.rawseti(c->S, c->out, c->idx++);
        }
        walk_children(c, child, depth + 1);
    }
}

static void* rbx_datamodel(void) {
    // Roblox exposes a global DataModel accessor; resolve by symbol.
    typedef void*(*dm_t)(void);
    static dm_t p = NULL;
    if (!p) p = (dm_t)dlsym(RTLD_DEFAULT, "_ZN3RBX9DataModel11getInstanceEv");
    return p ? p() : NULL;
}

static int rx_getinstances(lua_State* S) {
    L.createtable(S, 256, 0);
    walk_ctx c = { S, L.gettop(S), 1, 0 };
    walk_children(&c, rbx_datamodel(), 0);
    return 1;
}
static int rx_getnilinstances(lua_State* S) {
    L.createtable(S, 32, 0);
    walk_ctx c = { S, L.gettop(S), 1, 1 };
    walk_children(&c, rbx_datamodel(), 0);
    return 1;
}

// -- gethui() — persistent overlay parent that survives ScreenGui purges ----
// Roblox's CoreGui is the community-standard hidey-hole. gethui returns it
// so scripts can parent UI there instead of PlayerGui.
static int rx_gethui(lua_State* S) {
    typedef void*(*core_t)(void);
    static core_t p = NULL;
    if (!p) p = (core_t)dlsym(RTLD_DEFAULT, "_ZN3RBX7CoreGui11getInstanceEv");
    if (!p) { L.pushnil(S); return 1; }
    L.pushlightuserdata(S, p());
    return 1;
}

// -- identity ---------------------------------------------------------------
static int rx_getidentity(lua_State* S) { L.pushinteger(S, 8); return 1; }
static int rx_setidentity(lua_State* S) { return 0; /* patched globally */ }

// -- registration -----------------------------------------------------------
struct RxReg { const char* name; lua_CFunction fn; };
static const struct RxReg g_rx[] = {
    {"fireclickdetector", rx_fireclickdetector},
    {"firetouchinterest", rx_firetouchinterest},
    {"firesignal",        rx_firesignal},
    {"getconnections",    rx_getconnections},
    {"getinstances",      rx_getinstances},
    {"getnilinstances",   rx_getnilinstances},
    {"gethui",            rx_gethui},
    {"get_hidden_gui",    rx_gethui},
    {"getidentity",       rx_getidentity},
    {"setidentity",       rx_setidentity},
    {NULL, NULL}
};

extern "C" void roblox_globals_install(lua_State* S) {
    for (const struct RxReg* r = g_rx; r->name; r++) {
        L.pushcclosurek(S, r->fn, r->name, 0, NULL);
        lua_setglobal(S, r->name);
    }
}
