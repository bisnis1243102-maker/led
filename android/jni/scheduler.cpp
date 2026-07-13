#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include "luau_shim.h"

extern "C" void executor_mark_thread(lua_State*);
extern "C" char* luau_compile_bundled(const char*, size_t, void*, size_t*);

struct Job { lua_State* co; Job* next; };
static Job* g_head = NULL;
static Job* g_tail = NULL;
static pthread_mutex_t g_mtx = PTHREAD_MUTEX_INITIALIZER;
static lua_State* g_main = NULL;

static void queue_push(Job* j) {
    pthread_mutex_lock(&g_mtx);
    j->next = NULL;
    if (g_tail) g_tail->next = j; else g_head = j;
    g_tail = j;
    pthread_mutex_unlock(&g_mtx);
}
static Job* queue_pop(void) {
    pthread_mutex_lock(&g_mtx);
    Job* j = g_head;
    if (j) { g_head = j->next; if (!g_head) g_tail = NULL; }
    pthread_mutex_unlock(&g_mtx);
    return j;
}

extern "C" void sched_set_main(lua_State* S) { g_main = S; }

extern "C" void sched_execute(const char* src, size_t len) {
    if (!g_main) return;
    size_t bclen = 0;
    char* bc = luau_compile_bundled(src, len, NULL, &bclen);
    if (!bc) return;
    lua_State* co = L.newthread(g_main);
    if (L.loadbufferx(co, bc, bclen, "=exec", NULL) != 0) {
        free(bc); lua_pop(g_main, 1); return;
    }
    free(bc);
    executor_mark_thread(co);
    Job* j = (Job*)malloc(sizeof(Job));
    j->co = co;
    queue_push(j);
    L.pushvalue(g_main, -1);
    L.L_ref(g_main, LUA_REGISTRYINDEX);
    lua_pop(g_main, 1);
}

extern "C" void sched_tick(void) {
    Job* j;
    while ((j = queue_pop()) != NULL) {
        int status = L.resume(j->co, NULL, 0);
        if (status == LUA_YIELD) { queue_push(j); break; }
        free(j);
    }
}
