// Task-scheduler threading. Roblox's TaskScheduler::step runs per-frame on
// the render/game thread; anything a script yields on (wait, task.wait,
// coroutines, RunService signals) needs to resume on that thread. We spawn
// scripts as coroutines off the captured main state and drain the ready
// queue from a TaskScheduler::step hook.
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include "luau_shim.h"
#include "hooks.h"

extern "C" void executor_mark_thread(lua_State*);

struct Job {
    lua_State* co;      // coroutine
    Job* next;
};

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

// Execute source as a coroutine and queue it for the next scheduler tick.
extern "C" void sched_execute(const char* src, size_t len) {
    if (!g_main) return;
    typedef char* (*compile_t)(const char*, size_t, void*, size_t*);
    extern char* luau_compile_bundled(const char*, size_t, void*, size_t*);
    static compile_t compile = NULL;
    if (!compile) compile = luau_compile_bundled;
    size_t bclen = 0;
    char* bc = compile(src, len, NULL, &bclen);
    if (!bc) return;

    lua_State* co = L.newthread(g_main);
    if (L.loadbufferx(co, bc, bclen, "=exec", NULL) != 0) {
        free(bc);
        lua_pop(g_main, 1);
        return;
    }
    free(bc);
    executor_mark_thread(co);
    Job* j = (Job*)malloc(sizeof(Job));
    j->co = co;
    queue_push(j);
    // Pop the thread from g_main's stack — the coroutine stays GC-anchored
    // via the registry ref set below.
    L.pushvalue(g_main, -1);
    L.L_ref(g_main, LUA_REGISTRYINDEX);
    lua_pop(g_main, 1);
}

// Called from the TaskScheduler::step hook once per frame.
extern "C" void sched_tick(void) {
    Job* j;
    while ((j = queue_pop()) != NULL) {
        int status = L.resume(j->co, NULL, 0);
        if (status == LUA_YIELD) {
            // Re-queue for next tick
            queue_push(j);
            break; // one yield per tick to avoid re-entrant floods
        }
        free(j);
    }
}
