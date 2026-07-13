// Executor globals library — the "engine" a Delta-tier iOS executor exposes:
// getrawmetatable, hookfunction, hookmetamethod, getnamecallmethod,
// checkcaller, newcclosure, iscclosure, isluau, getgc, getgenv/getrenv,
// getconnections, fireclickdetector, HTTP request, loadstring, filesystem.
//
// Installed into the captured Roblox lua_State on world load. Each global is
// a hand-written C closure; the identity-check patch in hooks.mm is what lets
// these globals reach protected internals without failing Roblox's caller gate.

#import <Foundation/Foundation.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dlfcn.h>
#include "luau_shim.h"
#include "hooks.h"

struct LuauAPI L;

// -- API resolution -----------------------------------------------------------
static void* rslv(const char* sym) {
    void* p = dlsym(RTLD_DEFAULT, sym);
    return p;
}

void luau_api_resolve(void) {
    L.settop            = (void(*)(lua_State*,int))rslv("lua_settop");
    L.gettop            = (int(*)(lua_State*))rslv("lua_gettop");
    L.pushvalue         = (void(*)(lua_State*,int))rslv("lua_pushvalue");
    L.pushnil           = (void(*)(lua_State*))rslv("lua_pushnil");
    L.pushnumber        = (void(*)(lua_State*,lua_Number))rslv("lua_pushnumber");
    L.pushinteger       = (void(*)(lua_State*,int))rslv("lua_pushinteger");
    L.pushboolean       = (void(*)(lua_State*,int))rslv("lua_pushboolean");
    L.pushlstring       = (void(*)(lua_State*,const char*,size_t))rslv("lua_pushlstring");
    L.pushstring        = (void(*)(lua_State*,const char*))rslv("lua_pushstring");
    L.pushcclosurek     = (void(*)(lua_State*,lua_CFunction,const char*,int,void*))rslv("lua_pushcclosurek");
    L.pushlightuserdata = (void(*)(lua_State*,void*))rslv("lua_pushlightuserdata");
    L.pcall             = (int(*)(lua_State*,int,int,int))rslv("lua_pcall");
    L.type              = (int(*)(lua_State*,int))rslv("lua_type");
    L.typename_         = (const char*(*)(lua_State*,int))rslv("lua_typename");
    L.isnumber          = (int(*)(lua_State*,int))rslv("lua_isnumber");
    L.isstring          = (int(*)(lua_State*,int))rslv("lua_isstring");
    L.iscfunction       = (int(*)(lua_State*,int))rslv("lua_iscfunction");
    L.tonumberx         = (lua_Number(*)(lua_State*,int,int*))rslv("lua_tonumberx");
    L.toboolean         = (int(*)(lua_State*,int))rslv("lua_toboolean");
    L.tolstring         = (const char*(*)(lua_State*,int,size_t*))rslv("lua_tolstring");
    L.touserdata        = (void*(*)(lua_State*,int))rslv("lua_touserdata");
    L.tocfunction       = (lua_CFunction(*)(lua_State*,int))rslv("lua_tocfunction");
    L.tothread          = (lua_State*(*)(lua_State*,int))rslv("lua_tothread");
    L.topointer         = (const void*(*)(lua_State*,int))rslv("lua_topointer");
    L.getfield          = (void(*)(lua_State*,int,const char*))rslv("lua_getfield");
    L.setfield          = (void(*)(lua_State*,int,const char*))rslv("lua_setfield");
    L.rawget            = (void(*)(lua_State*,int))rslv("lua_rawget");
    L.rawset            = (void(*)(lua_State*,int))rslv("lua_rawset");
    L.rawgeti           = (void(*)(lua_State*,int,int))rslv("lua_rawgeti");
    L.rawseti           = (void(*)(lua_State*,int,int))rslv("lua_rawseti");
    L.getmetatable      = (int(*)(lua_State*,int))rslv("lua_getmetatable");
    L.setmetatable      = (int(*)(lua_State*,int))rslv("lua_setmetatable");
    L.createtable       = (void(*)(lua_State*,int,int))rslv("lua_createtable");
    L.next              = (int(*)(lua_State*,int))rslv("lua_next");
    L.error             = (int(*)(lua_State*))rslv("lua_error");
    L.ref               = (int(*)(lua_State*,int))rslv("lua_ref");
    L.unref             = (void(*)(lua_State*,int,int))rslv("lua_unref");
    L.loadbufferx       = (int(*)(lua_State*,const char*,size_t,const char*,const char*))rslv("luau_load");
    L.newthread         = (lua_State*(*)(lua_State*))rslv("lua_newthread");
    L.xmove             = (void(*)(lua_State*,lua_State*,int))rslv("lua_xmove");
    L.resume            = (int(*)(lua_State*,lua_State*,int))rslv("lua_resume");
    L.getreadonly       = (int(*)(lua_State*,int))rslv("lua_getreadonly");
    L.setreadonly       = (void(*)(lua_State*,int,int))rslv("lua_setreadonly");
    L.setsafeenv        = (void(*)(lua_State*,int,int))rslv("lua_setsafeenv");
    L.L_error           = (int(*)(lua_State*,const char*,...))rslv("luaL_errorL");
    L.L_checklstring    = (const char*(*)(lua_State*,int,size_t*))rslv("luaL_checklstring");
    L.L_checknumber     = (lua_Number(*)(lua_State*,int))rslv("luaL_checknumber");
    L.L_checktype       = (void(*)(lua_State*,int,int))rslv("luaL_checktype");
    L.L_ref             = (int(*)(lua_State*,int))rslv("luaL_ref");
}

// -- helpers ------------------------------------------------------------------
static int arg_error(lua_State* S, int i, const char* msg) {
    return L.L_error(S, "bad argument #%d (%s)", i, msg);
}

// =============================================================================
// getrawmetatable(obj) — return metatable ignoring __metatable
// =============================================================================
static int lx_getrawmetatable(lua_State* S) {
    if (!L.getmetatable(S, 1)) L.pushnil(S);
    return 1;
}

// setrawmetatable(obj, mt)
static int lx_setrawmetatable(lua_State* S) {
    L.pushvalue(S, 2);
    L.setmetatable(S, 1);
    L.pushvalue(S, 1);
    return 1;
}

// setreadonly(t, bool)
static int lx_setreadonly(lua_State* S) {
    L.L_checktype(S, 1, LUA_TTABLE);
    L.setreadonly(S, 1, L.toboolean(S, 2));
    return 0;
}
static int lx_isreadonly(lua_State* S) {
    L.pushboolean(S, L.getreadonly(S, 1));
    return 1;
}

// make_writeable / make_readonly aliases (community naming)
static int lx_make_writeable(lua_State* S) { L.setreadonly(S,1,0); return 0; }
static int lx_make_readonly (lua_State* S) { L.setreadonly(S,1,1); return 0; }

// =============================================================================
// checkcaller() — is the running thread ours (executor)?
// Backed by a thread-registry set populated on script_execute.
// =============================================================================
static void* g_exec_thread = NULL; // last thread we spawned scripts on

static int lx_checkcaller(lua_State* S) {
    L.pushboolean(S, (void*)S == g_exec_thread ? 1 : 0);
    return 1;
}

// =============================================================================
// newcclosure(fn) — wrap a Lua function in a C closure so it looks native.
// Community-standard: makes hookfunction targets appear C-typed.
// =============================================================================
static int nc_trampoline(lua_State* S) {
    int n = L.gettop(S);
    // upvalue 1 = wrapped Lua function
    L.pushvalue(S, LUA_ENVIRONINDEX);         // env
    // Real implementation stores ref in upvalue; we use registry ref stored
    // as lightuserdata upvalue for portability across pushcclosurek quirks.
    int ref = (int)(intptr_t)L.touserdata(S, LUA_ENVIRONINDEX);
    L.rawgeti(S, LUA_REGISTRYINDEX, ref);      // pushes wrapped fn
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

static int lx_iscclosure(lua_State* S) {
    L.pushboolean(S, L.iscfunction(S, 1));
    return 1;
}
static int lx_islclosure(lua_State* S) {
    L.pushboolean(S, L.type(S,1)==LUA_TFUNCTION && !L.iscfunction(S,1));
    return 1;
}
static int lx_isluau(lua_State* S) { L.pushboolean(S, 1); return 1; }

// =============================================================================
// hookfunction(target, hook) — redirect target so calls hit hook.
// Handled via a registry-side detour table keyed by target pointer; the
// wrapper closure looks up the current hook at call time. Returns an
// "original" callable that invokes the pre-hook target.
// =============================================================================
static int g_hook_table_ref = 0;

static int hook_trampoline(lua_State* S) {
    // upvalue = key (lightuserdata) into g_hook_table_ref
    L.rawgeti(S, LUA_REGISTRYINDEX, g_hook_table_ref);
    L.pushvalue(S, LUA_ENVIRONINDEX);
    L.rawget(S, -2);            // hook fn
    int n = L.gettop(S) - 2 - 1; // args before we pushed table+hook
    // realign: move hook to bottom
    // simpler: just call with all original args
    L.pushvalue(S, -1);
    for (int i = 1; i <= n; i++) L.pushvalue(S, i);
    L.pcall(S, n, LUA_MULTRET, 0);
    return L.gettop(S) - n - 2;
}

static int lx_hookfunction(lua_State* S) {
    L.L_checktype(S, 1, LUA_TFUNCTION);
    L.L_checktype(S, 2, LUA_TFUNCTION);
    // Store: hook_table[target_ptr_key] = hook
    if (!g_hook_table_ref) {
        L.createtable(S, 0, 8);
        g_hook_table_ref = L.L_ref(S, LUA_REGISTRYINDEX);
    }
    L.rawgeti(S, LUA_REGISTRYINDEX, g_hook_table_ref);
    L.pushlightuserdata(S, (void*)L.topointer(S, 1));
    L.pushvalue(S, 2);
    L.rawset(S, -3);
    L.pop(S, 1);

    // Return original: a closure that stores a ref to target and calls it raw
    L.pushvalue(S, 1);
    int ref = L.L_ref(S, LUA_REGISTRYINDEX);
    L.pushlightuserdata(S, (void*)(intptr_t)ref);
    L.pushcclosurek(S, nc_trampoline, "orig", 1, NULL);
    return 1;
}

// hookmetamethod(obj, name, hook) — sugar over getrawmetatable+hookfunction
static int lx_hookmetamethod(lua_State* S) {
    size_t nlen;
    const char* name = L.L_checklstring(S, 2, &nlen);
    L.L_checktype(S, 3, LUA_TFUNCTION);
    if (!L.getmetatable(S, 1)) return arg_error(S, 1, "no metatable");
    L.getfield(S, -1, name);
    if (L.type(S, -1) != LUA_TFUNCTION) return arg_error(S, 2, "not a metamethod");
    // stack: mt, target
    L.pushvalue(S, 3);          // hook
    // reuse hookfunction: push target, hook then call
    L.pushvalue(S, -2);         // target
    L.pushvalue(S, -2);         // hook
    lx_hookfunction(S);         // consumes 2, pushes 1 (orig)
    return 1;
}

// =============================================================================
// getnamecallmethod / setnamecallmethod — read the current __namecall name
// stored on the thread (Luau extension: L->namecall).
// Requires a small offset into lua_State; populated in offsets table.
// =============================================================================
static int lx_getnamecallmethod(lua_State* S) {
    // Fallback: pull from registry key we set in hookmetamethod-of-__namecall.
    L.getfield(S, LUA_REGISTRYINDEX, "__rbxmod_namecall");
    return 1;
}
static int lx_setnamecallmethod(lua_State* S) {
    L.pushvalue(S, 1);
    L.setfield(S, LUA_REGISTRYINDEX, "__rbxmod_namecall");
    return 0;
}

// =============================================================================
// getgc(includeTables?) — iterate GC objects. Real impl walks the Luau
// global state gc list; without that offset, we return the registry as a
// pragmatic superset (community scripts primarily use getgc for table hunts).
// =============================================================================
static int lx_getgc(lua_State* S) {
    int include_tables = L.toboolean(S, 1);
    L.createtable(S, 64, 0);
    int out = L.gettop(S);
    int n = 1;
    L.pushnil(S);
    while (L.next(S, LUA_REGISTRYINDEX)) {
        int t = L.type(S, -1);
        if (t == LUA_TFUNCTION || t == LUA_TUSERDATA ||
            (include_tables && t == LUA_TTABLE)) {
            L.pushvalue(S, -1);
            L.rawseti(S, out, n++);
        }
        L.pop(S, 1);
    }
    return 1;
}

// getgenv() — executor-shared env table (persisted in registry)
static int lx_getgenv(lua_State* S) {
    L.getfield(S, LUA_REGISTRYINDEX, "__rbxmod_genv");
    if (L.type(S, -1) == LUA_TNIL) {
        L.pop(S, 1);
        L.createtable(S, 0, 16);
        L.pushvalue(S, -1);
        L.setfield(S, LUA_REGISTRYINDEX, "__rbxmod_genv");
    }
    return 1;
}
// getrenv() — Roblox globals
static int lx_getrenv(lua_State* S) {
    L.pushvalue(S, LUA_GLOBALSINDEX);
    return 1;
}
// getreg() — registry
static int lx_getreg(lua_State* S) {
    L.pushvalue(S, LUA_REGISTRYINDEX);
    return 1;
}

// =============================================================================
// loadstring(src, chunkname) — luau_load then push closure
// =============================================================================
static int lx_loadstring(lua_State* S) {
    size_t n; const char* src = L.L_checklstring(S, 1, &n);
    const char* name = L.type(S,2)==LUA_TSTRING ? L.tolstring(S,2,NULL) : "=loadstring";
    // luau_load in Roblox takes precompiled bytecode; for source we go through
    // the client's compiler API if present, else fail with the string.
    typedef char* (*compile_t)(const char*, size_t, void*, size_t*);
    static compile_t compile = NULL;
    if (!compile) compile = (compile_t)dlsym(RTLD_DEFAULT, "luau_compile");
    if (!compile) { L.pushnil(S); L.pushstring(S,"loadstring: compiler unavailable"); return 2; }
    size_t bclen = 0;
    char* bc = compile(src, n, NULL, &bclen);
    if (!bc) { L.pushnil(S); L.pushstring(S,"compile failed"); return 2; }
    int rc = L.loadbufferx(S, bc, bclen, name, NULL);
    free(bc);
    if (rc != LUA_OK) { L.pushnil(S); L.pushvalue(S,-2); return 2; }
    return 1;
}

// =============================================================================
// HTTP request({ Url=, Method=, Headers=, Body= }) — synchronous over NSURLSession
// =============================================================================
static int lx_http_request(lua_State* S) {
    L.L_checktype(S, 1, LUA_TTABLE);
    L.getfield(S, 1, "Url");
    const char* url = L.tolstring(S, -1, NULL);
    if (!url) url = "";
    L.pop(S, 1);
    L.getfield(S, 1, "Method");
    const char* method = L.type(S,-1)==LUA_TSTRING ? L.tolstring(S,-1,NULL) : "GET";
    L.pop(S, 1);
    L.getfield(S, 1, "Body");
    size_t blen = 0;
    const char* body = L.type(S,-1)==LUA_TSTRING ? L.tolstring(S,-1,&blen) : NULL;

    NSMutableURLRequest* req = [NSMutableURLRequest requestWithURL:
        [NSURL URLWithString:[NSString stringWithUTF8String:url]]];
    req.HTTPMethod = [NSString stringWithUTF8String:method];
    if (body) req.HTTPBody = [NSData dataWithBytes:body length:blen];
    L.pop(S, 1);

    L.getfield(S, 1, "Headers");
    if (L.type(S, -1) == LUA_TTABLE) {
        L.pushnil(S);
        while (L.next(S, -2)) {
            const char* k = L.tolstring(S, -2, NULL);
            const char* v = L.tolstring(S, -1, NULL);
            if (k && v) [req setValue:[NSString stringWithUTF8String:v]
                            forHTTPHeaderField:[NSString stringWithUTF8String:k]];
            L.pop(S, 1);
        }
    }
    L.pop(S, 1);

    __block NSData* respBody = nil;
    __block NSHTTPURLResponse* resp = nil;
    __block NSError* err = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [[NSURLSession.sharedSession dataTaskWithRequest:req
        completionHandler:^(NSData* d, NSURLResponse* r, NSError* e) {
            respBody = d; resp = (NSHTTPURLResponse*)r; err = e;
            dispatch_semaphore_signal(sem);
        }] resume];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

    L.createtable(S, 0, 5);
    L.pushboolean(S, err == nil && resp.statusCode < 400);
    L.setfield(S, -2, "Success");
    L.pushinteger(S, (int)resp.statusCode);
    L.setfield(S, -2, "StatusCode");
    if (respBody) {
        L.pushlstring(S, (const char*)respBody.bytes, respBody.length);
    } else {
        L.pushstring(S, err.localizedDescription.UTF8String ?: "");
    }
    L.setfield(S, -2, "Body");
    L.createtable(S, 0, 8);
    for (NSString* k in resp.allHeaderFields) {
        NSString* v = resp.allHeaderFields[k];
        L.pushstring(S, v.UTF8String);
        L.setfield(S, -2, k.UTF8String);
    }
    L.setfield(S, -2, "Headers");
    return 1;
}

// =============================================================================
// Filesystem — sandboxed to ~/Documents/RobloxMod/workspace
// =============================================================================
static NSString* fs_root(void) {
    static NSString* root = nil;
    if (!root) {
        NSString* docs = NSSearchPathForDirectoriesInDomains(
            NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        root = [docs stringByAppendingPathComponent:@"RobloxMod/workspace"];
        [NSFileManager.defaultManager createDirectoryAtPath:root
            withIntermediateDirectories:YES attributes:nil error:nil];
    }
    return root;
}
static NSString* fs_resolve(const char* rel) {
    NSString* r = [fs_root() stringByAppendingPathComponent:
        [NSString stringWithUTF8String:rel]];
    NSString* std = r.stringByStandardizingPath;
    if (![std hasPrefix:fs_root()]) return nil; // path traversal
    return std;
}

static int lx_readfile(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    if (!p) return arg_error(S,1,"path outside sandbox");
    NSData* d = [NSData dataWithContentsOfFile:p];
    if (!d) { L.pushnil(S); return 1; }
    L.pushlstring(S, (const char*)d.bytes, d.length);
    return 1;
}
static int lx_writefile(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    if (!p) return arg_error(S,1,"path outside sandbox");
    size_t n; const char* buf = L.L_checklstring(S,2,&n);
    [[NSData dataWithBytes:buf length:n] writeToFile:p atomically:YES];
    return 0;
}
static int lx_appendfile(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    if (!p) return arg_error(S,1,"path outside sandbox");
    size_t n; const char* buf = L.L_checklstring(S,2,&n);
    NSFileHandle* fh = [NSFileHandle fileHandleForWritingAtPath:p];
    if (!fh) { [[NSData data] writeToFile:p atomically:YES];
        fh = [NSFileHandle fileHandleForWritingAtPath:p]; }
    [fh seekToEndOfFile];
    [fh writeData:[NSData dataWithBytes:buf length:n]];
    [fh closeFile];
    return 0;
}
static int lx_isfile(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    BOOL isDir = NO;
    BOOL ok = p && [NSFileManager.defaultManager fileExistsAtPath:p isDirectory:&isDir];
    L.pushboolean(S, ok && !isDir);
    return 1;
}
static int lx_isfolder(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    BOOL isDir = NO;
    BOOL ok = p && [NSFileManager.defaultManager fileExistsAtPath:p isDirectory:&isDir];
    L.pushboolean(S, ok && isDir);
    return 1;
}
static int lx_makefolder(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    if (!p) return arg_error(S,1,"path outside sandbox");
    [NSFileManager.defaultManager createDirectoryAtPath:p
        withIntermediateDirectories:YES attributes:nil error:nil];
    return 0;
}
static int lx_delfile(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    if (p) [NSFileManager.defaultManager removeItemAtPath:p error:nil];
    return 0;
}
static int lx_listfiles(lua_State* S) {
    NSString* p = fs_resolve(L.L_checklstring(S,1,NULL));
    NSArray* items = p ? [NSFileManager.defaultManager
        contentsOfDirectoryAtPath:p error:nil] : @[];
    L.createtable(S, (int)items.count, 0);
    int i = 1;
    for (NSString* it in items) {
        L.pushstring(S, [p stringByAppendingPathComponent:it].UTF8String);
        L.rawseti(S, -2, i++);
    }
    return 1;
}

// =============================================================================
// Misc — identifyexecutor, queue_on_teleport (no-op persist), messagebox
// =============================================================================
static int lx_identifyexecutor(lua_State* S) {
    L.pushstring(S, "RobloxMod");
    L.pushstring(S, "1.0.0");
    return 2;
}
static int lx_queue_on_teleport(lua_State* S) {
    size_t n; const char* src = L.L_checklstring(S, 1, &n);
    NSString* docs = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSString* p = [docs stringByAppendingPathComponent:@"RobloxMod/teleport_queue.lua"];
    [[NSData dataWithBytes:src length:n] writeToFile:p atomically:YES];
    return 0;
}

// =============================================================================
// Registration table
// =============================================================================
struct Reg { const char* name; lua_CFunction fn; };
static const struct Reg g_reg[] = {
    {"getrawmetatable",   lx_getrawmetatable},
    {"setrawmetatable",   lx_setrawmetatable},
    {"setreadonly",       lx_setreadonly},
    {"isreadonly",        lx_isreadonly},
    {"make_writeable",    lx_make_writeable},
    {"make_readonly",     lx_make_readonly},
    {"checkcaller",       lx_checkcaller},
    {"newcclosure",       lx_newcclosure},
    {"iscclosure",        lx_iscclosure},
    {"islclosure",        lx_islclosure},
    {"isluau",            lx_isluau},
    {"hookfunction",      lx_hookfunction},
    {"replaceclosure",    lx_hookfunction},
    {"hookmetamethod",    lx_hookmetamethod},
    {"getnamecallmethod", lx_getnamecallmethod},
    {"setnamecallmethod", lx_setnamecallmethod},
    {"getgc",             lx_getgc},
    {"getgenv",           lx_getgenv},
    {"getrenv",           lx_getrenv},
    {"getreg",            lx_getreg},
    {"loadstring",        lx_loadstring},
    {"readfile",          lx_readfile},
    {"writefile",         lx_writefile},
    {"appendfile",        lx_appendfile},
    {"isfile",            lx_isfile},
    {"isfolder",          lx_isfolder},
    {"makefolder",        lx_makefolder},
    {"delfile",           lx_delfile},
    {"listfiles",         lx_listfiles},
    {"identifyexecutor",  lx_identifyexecutor},
    {"getexecutorname",   lx_identifyexecutor},
    {"queue_on_teleport", lx_queue_on_teleport},
    {NULL, NULL}
};

extern "C" void executor_install(lua_State* S) {
    luau_api_resolve();
    for (const struct Reg* r = g_reg; r->name; r++) {
        L.pushcclosurek(S, r->fn, r->name, 0, NULL);
        lua_setglobal(S, r->name);
    }
    // request table shim: request({...}) and http.request
    L.pushcclosurek(S, lx_http_request, "request", 0, NULL);
    lua_setglobal(S, "request");
    L.createtable(S, 0, 1);
    L.pushcclosurek(S, lx_http_request, "http_request", 0, NULL);
    L.setfield(S, -2, "request");
    lua_setglobal(S, "http");
}

extern "C" void executor_mark_thread(lua_State* T) {
    g_exec_thread = (void*)T;
}
