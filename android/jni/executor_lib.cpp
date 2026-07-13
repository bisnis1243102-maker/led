// Executor globals — Android port. Identical Lua-side behavior to the iOS
// build; HTTP goes through JNI callback to Java (OkHttp), filesystem is
// sandboxed under /sdcard/Android/data/com.roblox.client/files/RobloxMod/.
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <sys/stat.h>
#include <dlfcn.h>
#include <jni.h>
#include "luau_shim.h"

extern "C" JavaVM* rbxmod_jvm(void);

struct LuauAPI L;

static void* rslv(const char* sym) { return dlsym(RTLD_DEFAULT, sym); }

void luau_api_resolve(void) {
    L.settop            = (decltype(L.settop))rslv("lua_settop");
    L.gettop            = (decltype(L.gettop))rslv("lua_gettop");
    L.pushvalue         = (decltype(L.pushvalue))rslv("lua_pushvalue");
    L.pushnil           = (decltype(L.pushnil))rslv("lua_pushnil");
    L.pushnumber        = (decltype(L.pushnumber))rslv("lua_pushnumber");
    L.pushinteger       = (decltype(L.pushinteger))rslv("lua_pushinteger");
    L.pushboolean       = (decltype(L.pushboolean))rslv("lua_pushboolean");
    L.pushlstring       = (decltype(L.pushlstring))rslv("lua_pushlstring");
    L.pushstring        = (decltype(L.pushstring))rslv("lua_pushstring");
    L.pushcclosurek     = (decltype(L.pushcclosurek))rslv("lua_pushcclosurek");
    L.pushlightuserdata = (decltype(L.pushlightuserdata))rslv("lua_pushlightuserdata");
    L.pcall             = (decltype(L.pcall))rslv("lua_pcall");
    L.type              = (decltype(L.type))rslv("lua_type");
    L.isnumber          = (decltype(L.isnumber))rslv("lua_isnumber");
    L.isstring          = (decltype(L.isstring))rslv("lua_isstring");
    L.iscfunction       = (decltype(L.iscfunction))rslv("lua_iscfunction");
    L.tonumberx         = (decltype(L.tonumberx))rslv("lua_tonumberx");
    L.toboolean         = (decltype(L.toboolean))rslv("lua_toboolean");
    L.tolstring         = (decltype(L.tolstring))rslv("lua_tolstring");
    L.touserdata        = (decltype(L.touserdata))rslv("lua_touserdata");
    L.tocfunction       = (decltype(L.tocfunction))rslv("lua_tocfunction");
    L.topointer         = (decltype(L.topointer))rslv("lua_topointer");
    L.getfield          = (decltype(L.getfield))rslv("lua_getfield");
    L.setfield          = (decltype(L.setfield))rslv("lua_setfield");
    L.rawget            = (decltype(L.rawget))rslv("lua_rawget");
    L.rawset            = (decltype(L.rawset))rslv("lua_rawset");
    L.rawgeti           = (decltype(L.rawgeti))rslv("lua_rawgeti");
    L.rawseti           = (decltype(L.rawseti))rslv("lua_rawseti");
    L.getmetatable      = (decltype(L.getmetatable))rslv("lua_getmetatable");
    L.setmetatable      = (decltype(L.setmetatable))rslv("lua_setmetatable");
    L.createtable       = (decltype(L.createtable))rslv("lua_createtable");
    L.next              = (decltype(L.next))rslv("lua_next");
    L.error             = (decltype(L.error))rslv("lua_error");
    L.unref             = (decltype(L.unref))rslv("lua_unref");
    L.loadbufferx       = (decltype(L.loadbufferx))rslv("luau_load");
    L.newthread         = (decltype(L.newthread))rslv("lua_newthread");
    L.resume            = (decltype(L.resume))rslv("lua_resume");
    L.getreadonly       = (decltype(L.getreadonly))rslv("lua_getreadonly");
    L.setreadonly       = (decltype(L.setreadonly))rslv("lua_setreadonly");
    L.L_error           = (decltype(L.L_error))rslv("luaL_errorL");
    L.L_checklstring    = (decltype(L.L_checklstring))rslv("luaL_checklstring");
    L.L_checknumber     = (decltype(L.L_checknumber))rslv("luaL_checknumber");
    L.L_checktype       = (decltype(L.L_checktype))rslv("luaL_checktype");
    L.L_ref             = (decltype(L.L_ref))rslv("luaL_ref");
}

// -- helpers ----------------------------------------------------------------
static void* g_exec_thread = NULL;

static int lx_getrawmetatable(lua_State* S) {
    if (!L.getmetatable(S, 1)) L.pushnil(S);
    return 1;
}
static int lx_setrawmetatable(lua_State* S) {
    L.pushvalue(S, 2); L.setmetatable(S, 1); L.pushvalue(S, 1); return 1;
}
static int lx_setreadonly(lua_State* S) {
    L.L_checktype(S, 1, LUA_TTABLE);
    L.setreadonly(S, 1, L.toboolean(S, 2));
    return 0;
}
static int lx_isreadonly(lua_State* S) {
    L.pushboolean(S, L.getreadonly(S, 1)); return 1;
}
static int lx_checkcaller(lua_State* S) {
    L.pushboolean(S, (void*)S == g_exec_thread ? 1 : 0); return 1;
}
static int lx_isluau(lua_State* S) { L.pushboolean(S, 1); return 1; }
static int lx_iscclosure(lua_State* S) { L.pushboolean(S, L.iscfunction(S, 1)); return 1; }
static int lx_islclosure(lua_State* S) {
    L.pushboolean(S, L.type(S,1)==LUA_TFUNCTION && !L.iscfunction(S,1));
    return 1;
}

static int nc_trampoline(lua_State* S) {
    int n = L.gettop(S);
    int ref = (int)(intptr_t)L.touserdata(S, LUA_ENVIRONINDEX);
    L.rawgeti(S, LUA_REGISTRYINDEX, ref);
    for (int i = 1; i <= n; i++) L.pushvalue(S, i);
    L.pcall(S, n, LUA_MULTRET, 0);
    return L.gettop(S) - n;
}
static int lx_newcclosure(lua_State* S) {
    L.L_checktype(S, 1, LUA_TFUNCTION);
    L.pushvalue(S, 1);
    int ref = L.L_ref(S, LUA_REGISTRYINDEX);
    L.pushlightuserdata(S, (void*)(intptr_t)ref);
    L.pushcclosurek(S, nc_trampoline, "cclosure", 1, NULL);
    return 1;
}

// hookfunction — direct proto/cfunction swap
extern "C" uintptr_t g_off_closure_isC;
extern "C" uintptr_t g_off_closure_l_p;
extern "C" uintptr_t g_off_closure_c_f;

static int lx_hookfunction(lua_State* S) {
    L.L_checktype(S, 1, LUA_TFUNCTION);
    L.L_checktype(S, 2, LUA_TFUNCTION);
    void* target = (void*)L.topointer(S, 1);
    void* hook   = (void*)L.topointer(S, 2);
    uint8_t t_isC = *((uint8_t*)target + g_off_closure_isC);
    uint8_t h_isC = *((uint8_t*)hook   + g_off_closure_isC);
    if (t_isC && h_isC) {
        void* pre = *(void**)((uint8_t*)target + g_off_closure_c_f);
        *(void**)((uint8_t*)target + g_off_closure_c_f) =
            *(void**)((uint8_t*)hook + g_off_closure_c_f);
        L.pushlightuserdata(S, pre);
        L.pushcclosurek(S, (lua_CFunction)pre, "orig", 0, NULL);
        return 1;
    }
    if (!t_isC && !h_isC) {
        void* pre = *(void**)((uint8_t*)target + g_off_closure_l_p);
        *(void**)((uint8_t*)target + g_off_closure_l_p) =
            *(void**)((uint8_t*)hook + g_off_closure_l_p);
        L.pushvalue(S, 1);
        void* clone = (void*)L.topointer(S, -1);
        *(void**)((uint8_t*)clone + g_off_closure_l_p) = pre;
        return 1;
    }
    L.pushnil(S); return 1;
}

// -- HTTP via JNI ----------------------------------------------------------
static jclass  g_httpCls = NULL;
static jmethodID g_httpMid = NULL;

static void ensure_http(JNIEnv* env) {
    if (g_httpCls) return;
    jclass c = env->FindClass("com/byte/robloxmod/HttpBridge");
    if (!c) return;
    g_httpCls = (jclass)env->NewGlobalRef(c);
    g_httpMid = env->GetStaticMethodID(g_httpCls, "request",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
}

static int lx_http_request(lua_State* S) {
    L.L_checktype(S, 1, LUA_TTABLE);
    L.getfield(S, 1, "Url");
    const char* url = L.tolstring(S, -1, NULL); lua_pop(S,1);
    L.getfield(S, 1, "Method");
    const char* method = L.type(S,-1)==LUA_TSTRING ? L.tolstring(S,-1,NULL) : "GET";
    lua_pop(S,1);
    L.getfield(S, 1, "Body");
    const char* body = L.type(S,-1)==LUA_TSTRING ? L.tolstring(S,-1,NULL) : "";
    lua_pop(S,1);

    JavaVM* vm = rbxmod_jvm();
    JNIEnv* env = NULL;
    bool detach = false;
    if (vm->GetEnv((void**)&env, JNI_VERSION_1_6) != JNI_OK) {
        vm->AttachCurrentThread(&env, NULL);
        detach = true;
    }
    ensure_http(env);
    if (!g_httpMid) { L.createtable(S,0,0); return 1; }

    jstring ju = env->NewStringUTF(url ?: "");
    jstring jm = env->NewStringUTF(method);
    jstring jb = env->NewStringUTF(body);
    jstring jr = (jstring)env->CallStaticObjectMethod(g_httpCls, g_httpMid, ju, jm, jb);
    const char* resp = jr ? env->GetStringUTFChars(jr, NULL) : "";

    L.createtable(S, 0, 3);
    L.pushstring(S, resp ?: "");
    L.setfield(S, -2, "Body");
    L.pushinteger(S, 200);
    L.setfield(S, -2, "StatusCode");
    L.pushboolean(S, jr != NULL);
    L.setfield(S, -2, "Success");

    if (resp) env->ReleaseStringUTFChars(jr, resp);
    env->DeleteLocalRef(ju); env->DeleteLocalRef(jm); env->DeleteLocalRef(jb);
    if (jr) env->DeleteLocalRef(jr);
    if (detach) vm->DetachCurrentThread();
    return 1;
}

// -- Filesystem (sandboxed) --------------------------------------------------
static const char* fs_root(void) {
    static char root[512] = {0};
    if (!root[0]) {
        snprintf(root, sizeof(root),
            "/sdcard/Android/data/com.roblox.client/files/RobloxMod/workspace");
        mkdir("/sdcard/Android/data/com.roblox.client/files/RobloxMod", 0755);
        mkdir(root, 0755);
    }
    return root;
}
static int fs_resolve(const char* rel, char* out, size_t n) {
    if (strstr(rel, "..")) return -1;
    snprintf(out, n, "%s/%s", fs_root(), rel);
    return 0;
}
static int lx_readfile(lua_State* S) {
    char p[1024];
    if (fs_resolve(L.L_checklstring(S,1,NULL), p, sizeof(p))) { L.pushnil(S); return 1; }
    FILE* f = fopen(p, "rb");
    if (!f) { L.pushnil(S); return 1; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
    char* buf = (char*)malloc(sz);
    fread(buf, 1, sz, f); fclose(f);
    L.pushlstring(S, buf, sz); free(buf); return 1;
}
static int lx_writefile(lua_State* S) {
    char p[1024];
    if (fs_resolve(L.L_checklstring(S,1,NULL), p, sizeof(p))) return 0;
    size_t n; const char* buf = L.L_checklstring(S, 2, &n);
    FILE* f = fopen(p, "wb"); if (!f) return 0;
    fwrite(buf, 1, n, f); fclose(f); return 0;
}
static int lx_isfile(lua_State* S) {
    char p[1024];
    if (fs_resolve(L.L_checklstring(S,1,NULL), p, sizeof(p))) { L.pushboolean(S,0); return 1; }
    struct stat st;
    L.pushboolean(S, stat(p, &st) == 0 && S_ISREG(st.st_mode));
    return 1;
}
static int lx_delfile(lua_State* S) {
    char p[1024];
    if (fs_resolve(L.L_checklstring(S,1,NULL), p, sizeof(p))) return 0;
    unlink(p); return 0;
}

// -- Misc -------------------------------------------------------------------
static int lx_identifyexecutor(lua_State* S) {
    L.pushstring(S, "RobloxMod-Android"); L.pushstring(S, "1.0.0"); return 2;
}
static int lx_getgenv(lua_State* S) {
    L.getfield(S, LUA_REGISTRYINDEX, "__rbxmod_genv");
    if (L.type(S, -1) == LUA_TNIL) {
        lua_pop(S, 1);
        L.createtable(S, 0, 16);
        L.pushvalue(S, -1);
        L.setfield(S, LUA_REGISTRYINDEX, "__rbxmod_genv");
    }
    return 1;
}
static int lx_getrenv(lua_State* S) { L.pushvalue(S, LUA_GLOBALSINDEX); return 1; }
static int lx_getreg(lua_State* S)  { L.pushvalue(S, LUA_REGISTRYINDEX); return 1; }

extern "C" char* luau_compile_bundled(const char*, size_t, void*, size_t*);
static int lx_loadstring(lua_State* S) {
    size_t n; const char* src = L.L_checklstring(S, 1, &n);
    typedef char* (*compile_t)(const char*, size_t, void*, size_t*);
    static compile_t compile = NULL;
    if (!compile) compile = (compile_t)dlsym(RTLD_DEFAULT, "luau_compile");
    if (!compile) compile = luau_compile_bundled;
    size_t bclen = 0;
    char* bc = compile(src, n, NULL, &bclen);
    if (!bc) { L.pushnil(S); L.pushstring(S,"compile failed"); return 2; }
    int rc = L.loadbufferx(S, bc, bclen, "=loadstring", NULL);
    free(bc);
    if (rc != LUA_OK) { L.pushnil(S); L.pushvalue(S,-2); return 2; }
    return 1;
}

struct Reg { const char* name; lua_CFunction fn; };
static const struct Reg g_reg[] = {
    {"getrawmetatable",  lx_getrawmetatable},
    {"setrawmetatable",  lx_setrawmetatable},
    {"setreadonly",      lx_setreadonly},
    {"isreadonly",       lx_isreadonly},
    {"checkcaller",      lx_checkcaller},
    {"isluau",           lx_isluau},
    {"iscclosure",       lx_iscclosure},
    {"islclosure",       lx_islclosure},
    {"newcclosure",      lx_newcclosure},
    {"hookfunction",     lx_hookfunction},
    {"replaceclosure",   lx_hookfunction},
    {"loadstring",       lx_loadstring},
    {"request",          lx_http_request},
    {"readfile",         lx_readfile},
    {"writefile",        lx_writefile},
    {"isfile",           lx_isfile},
    {"delfile",          lx_delfile},
    {"identifyexecutor", lx_identifyexecutor},
    {"getgenv",          lx_getgenv},
    {"getrenv",          lx_getrenv},
    {"getreg",           lx_getreg},
    {NULL, NULL}
};

extern "C" void executor_install(lua_State* S) {
    luau_api_resolve();
    for (const struct Reg* r = g_reg; r->name; r++) {
        L.pushcclosurek(S, r->fn, r->name, 0, NULL);
        lua_setglobal(S, r->name);
    }
}
extern "C" void executor_mark_thread(lua_State* T) { g_exec_thread = (void*)T; }
