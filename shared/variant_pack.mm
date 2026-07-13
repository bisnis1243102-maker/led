// Roblox Reflection::Variant array packer for Signal::Fire multi-arg calls.
// Builds a VariantArray from a Lua stack range, calls the C++ Fire method,
// releases the array. Type coverage matches what community scripts pass
// through fireclickdetector/firesignal: nil, bool, number, string, Instance.
#include <string.h>
#include <stdlib.h>
#include "luau_shim.h"
#include "hooks.h"

// Variant layout in Roblox reflection (arm64e, current builds):
//   [0x00]  tag  (uint32_t) : 0=nil 1=bool 2=int 3=double 4=string 5=Instance
//   [0x08]  payload (union, 24 bytes to cover string+refcount)
// VariantArray:
//   [0x00]  Variant* data
//   [0x08]  size_t count
struct Variant   { uint32_t tag; uint8_t pad[4]; uint8_t payload[24]; };
struct VarArray  { Variant* data; size_t count; };

static void pack_one(lua_State* S, int idx, Variant* v) {
    memset(v, 0, sizeof(*v));
    int t = L.type(S, idx);
    switch (t) {
        case LUA_TNIL:     v->tag = 0; break;
        case LUA_TBOOLEAN: v->tag = 1; *(int*)v->payload = L.toboolean(S, idx); break;
        case LUA_TNUMBER: {
            double d = L.tonumberx(S, idx, NULL);
            if (d == (int64_t)d) { v->tag = 2; *(int64_t*)v->payload = (int64_t)d; }
            else                 { v->tag = 3; *(double*)v->payload = d; }
            break;
        }
        case LUA_TSTRING: {
            size_t n; const char* s = L.tolstring(S, idx, &n);
            v->tag = 4;
            char* copy = (char*)malloc(n + 1);
            memcpy(copy, s, n); copy[n] = 0;
            *(char**)v->payload = copy;
            *(size_t*)(v->payload + 8) = n;
            break;
        }
        case LUA_TUSERDATA: {
            v->tag = 5;
            void* inst = *(void**)L.touserdata(S, idx);
            *(void**)v->payload = inst;
            break;
        }
        default: v->tag = 0; break;
    }
}

extern "C" void variant_array_build(lua_State* S, int firstArg, int lastArg,
                                    VarArray* out) {
    int n = lastArg - firstArg + 1;
    if (n <= 0) { out->data = NULL; out->count = 0; return; }
    out->data = (Variant*)calloc(n, sizeof(Variant));
    out->count = n;
    for (int i = 0; i < n; i++) pack_one(S, firstArg + i, &out->data[i]);
}

extern "C" void variant_array_free(VarArray* v) {
    if (!v || !v->data) return;
    for (size_t i = 0; i < v->count; i++) {
        if (v->data[i].tag == 4) free(*(void**)v->data[i].payload);
    }
    free(v->data);
    v->data = NULL; v->count = 0;
}
