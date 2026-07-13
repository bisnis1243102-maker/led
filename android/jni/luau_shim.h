// Same as iOS luau_shim.h — Luau C API resolved at runtime.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lua_State lua_State;
typedef int (*lua_CFunction)(lua_State*);
typedef double lua_Number;

#define LUA_TNIL             0
#define LUA_TBOOLEAN         1
#define LUA_TLIGHTUSERDATA   2
#define LUA_TNUMBER          3
#define LUA_TVECTOR          4
#define LUA_TSTRING          5
#define LUA_TTABLE           6
#define LUA_TFUNCTION        7
#define LUA_TUSERDATA        8
#define LUA_TTHREAD          9

#define LUA_REGISTRYINDEX    (-10000)
#define LUA_ENVIRONINDEX     (-10001)
#define LUA_GLOBALSINDEX     (-10002)

#define LUA_MULTRET          (-1)
#define LUA_OK               0
#define LUA_YIELD            1

struct LuauAPI {
    void        (*settop)(lua_State*, int);
    int         (*gettop)(lua_State*);
    void        (*pushvalue)(lua_State*, int);
    void        (*pushnil)(lua_State*);
    void        (*pushnumber)(lua_State*, lua_Number);
    void        (*pushinteger)(lua_State*, int);
    void        (*pushboolean)(lua_State*, int);
    void        (*pushlstring)(lua_State*, const char*, size_t);
    void        (*pushstring)(lua_State*, const char*);
    void        (*pushcclosurek)(lua_State*, lua_CFunction, const char*, int, void*);
    void        (*pushlightuserdata)(lua_State*, void*);
    int         (*pcall)(lua_State*, int, int, int);
    int         (*type)(lua_State*, int);
    int         (*isnumber)(lua_State*, int);
    int         (*isstring)(lua_State*, int);
    int         (*iscfunction)(lua_State*, int);
    lua_Number  (*tonumberx)(lua_State*, int, int*);
    int         (*toboolean)(lua_State*, int);
    const char* (*tolstring)(lua_State*, int, size_t*);
    void*       (*touserdata)(lua_State*, int);
    lua_CFunction (*tocfunction)(lua_State*, int);
    const void* (*topointer)(lua_State*, int);
    void        (*getfield)(lua_State*, int, const char*);
    void        (*setfield)(lua_State*, int, const char*);
    void        (*rawget)(lua_State*, int);
    void        (*rawset)(lua_State*, int);
    void        (*rawgeti)(lua_State*, int, int);
    void        (*rawseti)(lua_State*, int, int);
    int         (*getmetatable)(lua_State*, int);
    int         (*setmetatable)(lua_State*, int);
    void        (*createtable)(lua_State*, int, int);
    int         (*next)(lua_State*, int);
    int         (*error)(lua_State*);
    void        (*unref)(lua_State*, int, int);
    int         (*loadbufferx)(lua_State*, const char*, size_t, const char*, const char*);
    lua_State*  (*newthread)(lua_State*);
    int         (*resume)(lua_State*, lua_State*, int);
    int         (*getreadonly)(lua_State*, int);
    void        (*setreadonly)(lua_State*, int, int);
    int         (*L_error)(lua_State*, const char*, ...);
    const char* (*L_checklstring)(lua_State*, int, size_t*);
    lua_Number  (*L_checknumber)(lua_State*, int);
    void        (*L_checktype)(lua_State*, int, int);
    int         (*L_ref)(lua_State*, int);
};

extern struct LuauAPI L;
void luau_api_resolve(void);

#define lua_pop(S, n)          L.settop((S), -(n)-1)
#define lua_isnil(S, i)        (L.type((S),(i)) == LUA_TNIL)
#define lua_setglobal(S, k)    L.setfield((S), LUA_GLOBALSINDEX, (k))
#define lua_getglobal(S, k)    L.getfield((S), LUA_GLOBALSINDEX, (k))

#ifdef __cplusplus
}
#endif
