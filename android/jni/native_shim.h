// Android/ELF equivalents of the iOS mach/dyld shim.
// The Lua-side executor library compiles unchanged against this header.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <sys/mman.h>
#include <link.h>
#include <dlfcn.h>

#ifdef __cplusplus
extern "C" {
#endif

// -- Roblox image base resolution --------------------------------------------
extern void*      g_roblox_base;
extern uintptr_t  g_roblox_size;

void   rbx_find_base(void);
void*  rbx_slide(uintptr_t off);
void*  rbx_resolve(const char* sym);

// -- Memory patching ---------------------------------------------------------
int  rbx_patch_bytes(void* dst, const void* src, size_t n);
int  rbx_hook_branch(void* at, void* target);   // arm64 abs branch stub

// -- Anti-detection: hide our .so from /proc/self/maps + dl_iterate_phdr ----
void antidetect_install(void);

#ifdef __cplusplus
}
#endif
