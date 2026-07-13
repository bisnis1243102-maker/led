// Android/ELF native runtime for RobloxMod.
#include "native_shim.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/uio.h>
#include <link.h>
#include <dlfcn.h>
#include <pthread.h>
#include <android/log.h>

#define LOG_TAG "RobloxMod"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

void*     g_roblox_base = NULL;
uintptr_t g_roblox_size = 0;
static void* g_roblox_handle = NULL;

// dl_iterate_phdr callback: look for libroblox.so / librbxcore.so
static int find_cb(struct dl_phdr_info* info, size_t, void* data) {
    const char* name = info->dlpi_name ? info->dlpi_name : "";
    if (strstr(name, "libroblox")    ||
        strstr(name, "librbxclient") ||
        strstr(name, "libapp")) {
        *(uintptr_t*)data = (uintptr_t)info->dlpi_addr;
        uintptr_t maxvaddr = 0;
        for (int i = 0; i < info->dlpi_phnum; i++) {
            const ElfW(Phdr)* p = &info->dlpi_phdr[i];
            if (p->p_type == PT_LOAD) {
                uintptr_t end = p->p_vaddr + p->p_memsz;
                if (end > maxvaddr) maxvaddr = end;
            }
        }
        g_roblox_size = maxvaddr;
        LOGI("found roblox lib '%s' base=%p size=%zx", name,
             (void*)info->dlpi_addr, g_roblox_size);
        return 1; // stop iteration
    }
    return 0;
}

void rbx_find_base(void) {
    uintptr_t base = 0;
    dl_iterate_phdr(find_cb, &base);
    if (base) g_roblox_base = (void*)base;
    if (!g_roblox_base) {
        // fallback: try dlopen
        g_roblox_handle = dlopen("libroblox.so", RTLD_NOW | RTLD_NOLOAD);
        if (!g_roblox_handle) g_roblox_handle = dlopen("librbxclient.so", RTLD_NOW | RTLD_NOLOAD);
        LOGI("dlopen handle=%p", g_roblox_handle);
    }
}

void* rbx_slide(uintptr_t off) {
    return (void*)((uintptr_t)g_roblox_base + off);
}

void* rbx_resolve(const char* sym) {
    if (g_roblox_handle) {
        void* p = dlsym(g_roblox_handle, sym);
        if (p) return p;
    }
    return dlsym(RTLD_DEFAULT, sym);
}

// -- Memory patching ---------------------------------------------------------
int rbx_patch_bytes(void* dst, const void* src, size_t n) {
    uintptr_t page = (uintptr_t)dst & ~(uintptr_t)0xFFF;
    size_t span = ((uintptr_t)dst + n) - page;
    span = (span + 0xFFF) & ~(size_t)0xFFF;
    if (mprotect((void*)page, span, PROT_READ | PROT_WRITE | PROT_EXEC) != 0) {
        LOGE("mprotect RWX failed at %p", (void*)page);
        return -1;
    }
    memcpy(dst, src, n);
    mprotect((void*)page, span, PROT_READ | PROT_EXEC);
    __builtin___clear_cache((char*)dst, (char*)dst + n);
    return 0;
}

int rbx_hook_branch(void* at, void* target) {
    // arm64: LDR X16,[PC,#8]; BR X16; <target 8 bytes>
    uint32_t stub[4] = { 0x58000051, 0xD61F0220, 0, 0 };
    uint64_t t = (uint64_t)target;
    memcpy(&stub[2], &t, 8);
    return rbx_patch_bytes(at, stub, sizeof(stub));
}

// -- Anti-detection ----------------------------------------------------------
// Roblox on Android does two things to detect injected .so:
//   1. dl_iterate_phdr walk of loaded objects
//   2. /proc/self/maps scan for unexpected paths
// We hook (1) by patching the return-check in libdl, and (2) by patching
// open()/openat() to redirect /proc/self/maps to a filtered copy.

static int (*o_dl_iterate)(int(*)(struct dl_phdr_info*, size_t, void*), void*);
static void* g_self_base = NULL;

static int dl_filter_cb(struct dl_phdr_info* info, size_t sz, void* data) {
    if ((void*)info->dlpi_addr == g_self_base) return 0;
    typedef int(*user_cb_t)(struct dl_phdr_info*, size_t, void*);
    struct { user_cb_t cb; void* d; } *w = (decltype(w))data;
    return w->cb(info, sz, w->d);
}

static int h_dl_iterate(int(*cb)(struct dl_phdr_info*, size_t, void*), void* data) {
    struct { void* cb; void* d; } w = { (void*)cb, data };
    return o_dl_iterate(dl_filter_cb, &w);
}

// Filtered /proc/self/maps: write a version excluding our .so, tmpfile it,
// redirect open()/openat() calls that target that path.
static int g_filtered_maps_fd = -1;
static int (*o_open)(const char*, int, ...);
static int (*o_openat)(int, const char*, int, ...);

static int rebuild_filtered_maps(void) {
    FILE* in = fopen("/proc/self/maps", "r");
    if (!in) return -1;
    char tmpl[] = "/data/local/tmp/rbxmod_maps.XXXXXX";
    int fd = mkstemp(tmpl);
    if (fd < 0) { fclose(in); return -1; }
    unlink(tmpl);   // anonymous
    char line[1024];
    while (fgets(line, sizeof(line), in)) {
        if (strstr(line, "libRobloxMod") ||
            strstr(line, "librobloxmod")) continue;
        write(fd, line, strlen(line));
    }
    fclose(in);
    lseek(fd, 0, SEEK_SET);
    return fd;
}

static int h_open(const char* path, int flags, ...) {
    if (path && strcmp(path, "/proc/self/maps") == 0) {
        int fd = rebuild_filtered_maps();
        if (fd >= 0) return fd;
    }
    mode_t m = 0;
    if (flags & O_CREAT) {
        va_list ap; va_start(ap, flags);
        m = va_arg(ap, int);
        va_end(ap);
    }
    return o_open(path, flags, m);
}

static int h_openat(int dfd, const char* path, int flags, ...) {
    if (path && strcmp(path, "/proc/self/maps") == 0) {
        int fd = rebuild_filtered_maps();
        if (fd >= 0) return fd;
    }
    mode_t m = 0;
    if (flags & O_CREAT) {
        va_list ap; va_start(ap, flags);
        m = va_arg(ap, int);
        va_end(ap);
    }
    return o_openat(dfd, path, flags, m);
}

void antidetect_install(void) {
    Dl_info info;
    if (dladdr((const void*)&antidetect_install, &info)) {
        g_self_base = info.dli_fbase;
    }
    o_dl_iterate = (decltype(o_dl_iterate))dlsym(RTLD_DEFAULT, "dl_iterate_phdr");
    o_open       = (decltype(o_open))dlsym(RTLD_DEFAULT, "open");
    o_openat     = (decltype(o_openat))dlsym(RTLD_DEFAULT, "openat");
    if (o_dl_iterate) rbx_hook_branch((void*)o_dl_iterate, (void*)&h_dl_iterate);
    if (o_open)       rbx_hook_branch((void*)o_open,       (void*)&h_open);
    if (o_openat)     rbx_hook_branch((void*)o_openat,     (void*)&h_openat);
    LOGI("antidetect installed; self=%p", g_self_base);
}
