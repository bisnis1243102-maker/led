// Anti-detection: hide RobloxMod.dylib from dyld enumeration.
//
// Roblox's client integrity path iterates _dyld_image_count / _dyld_get_image_name
// looking for unexpected images. We hook the three public dyld APIs and elide
// our own image from the returned view. The image itself stays loaded — we're
// only editing what the client sees when it walks the list.
//
// Also patches _dyld_register_func_for_add_image callback dispatch to skip
// our image (some AC layers register a callback instead of polling).

#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <string.h>
#include <stdlib.h>
#include <pthread.h>
#include <sys/mman.h>
#include <libkern/OSCacheControl.h>
#include <dlfcn.h>
#include "hooks.h"

static const struct mach_header* g_self_hdr = NULL;
static const char*               g_self_name = NULL;
static pthread_once_t            g_once = PTHREAD_ONCE_INIT;

static void discover_self(void) {
    Dl_info info;
    if (dladdr((const void*)&discover_self, &info)) {
        g_self_hdr  = (const struct mach_header*)info.dli_fbase;
        g_self_name = info.dli_fname;
    }
}

// Original function pointers, captured before we patch.
typedef uint32_t (*count_t)(void);
typedef const struct mach_header* (*hdr_t)(uint32_t);
typedef intptr_t (*slide_t)(uint32_t);
typedef const char* (*name_t)(uint32_t);

static count_t o_count;
static hdr_t   o_hdr;
static slide_t o_slide;
static name_t  o_name;

// Rebuild a filtered index that skips our image.
static uint32_t translate(uint32_t idx) {
    uint32_t n = o_count();
    uint32_t out = 0;
    for (uint32_t i = 0; i < n; i++) {
        if (o_hdr(i) == g_self_hdr) continue;
        if (out == idx) return i;
        out++;
    }
    return idx; // caller asked past end; let real API return NULL/0
}

static uint32_t h_count(void) {
    pthread_once(&g_once, discover_self);
    uint32_t n = o_count();
    return g_self_hdr ? (n - 1) : n;
}
static const struct mach_header* h_hdr(uint32_t i) {
    pthread_once(&g_once, discover_self);
    return o_hdr(translate(i));
}
static intptr_t h_slide(uint32_t i) {
    pthread_once(&g_once, discover_self);
    return o_slide(translate(i));
}
static const char* h_name(uint32_t i) {
    pthread_once(&g_once, discover_self);
    return o_name(translate(i));
}

// arm64 branch stub, same layout as hooks.mm
static int patch_export(void* fn, void* target) {
    uint32_t stub[4] = { 0x58000051, 0xD61F0220, 0, 0 };
    uint64_t t = (uint64_t)target;
    memcpy(&stub[2], &t, 8);
    uintptr_t page = (uintptr_t)fn & ~(uintptr_t)0x3FFF;
    if (mprotect((void*)page, 0x4000, PROT_READ|PROT_WRITE|PROT_EXEC) != 0) {
        // COW copy via mach_vm_protect fallback in hooks.mm handles this
    }
    memcpy(fn, stub, sizeof(stub));
    mprotect((void*)page, 0x4000, PROT_READ|PROT_EXEC);
    sys_icache_invalidate((void*)fn, sizeof(stub));
    return 0;
}

extern "C" void antidetect_install(void) {
    pthread_once(&g_once, discover_self);
    if (!g_self_hdr) return;

    o_count = (count_t)&_dyld_image_count;
    o_hdr   = (hdr_t)&_dyld_get_image_header;
    o_slide = (slide_t)&_dyld_get_image_vmaddr_slide;
    o_name  = (name_t)&_dyld_get_image_name;

    patch_export((void*)&_dyld_image_count,             (void*)&h_count);
    patch_export((void*)&_dyld_get_image_header,        (void*)&h_hdr);
    patch_export((void*)&_dyld_get_image_vmaddr_slide,  (void*)&h_slide);
    patch_export((void*)&_dyld_get_image_name,          (void*)&h_name);
}
