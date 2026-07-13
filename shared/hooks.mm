// Cross-target hook core — same TU compiled into the Theos tweak (.dylib)
// and linked into the patched-IPA companion dylib injected via LC_LOAD_DYLIB.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <mach/mach.h>
#include <sys/mman.h>
#include <dlfcn.h>
#include <pthread.h>
#include <string.h>
#include "hooks.h"

struct RobloxOffsets g_off;
static uintptr_t g_slide = 0;
static void* g_image = NULL;

// -- fishhook-style rebinding + trampoline hook --------------------------------
extern "C" {
    kern_return_t mach_vm_protect(vm_map_t, mach_vm_address_t, mach_vm_size_t,
                                  boolean_t, vm_prot_t);
}

static int rbx_patch_bytes(void* dst, const void* src, size_t n) {
    uintptr_t page = (uintptr_t)dst & ~(uintptr_t)0x3FFF;
    size_t span = ((uintptr_t)dst + n) - page;
    if (mach_vm_protect(mach_task_self(), page, span, 0,
        VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY) != KERN_SUCCESS) return -1;
    memcpy(dst, src, n);
    mach_vm_protect(mach_task_self(), page, span, 0,
        VM_PROT_READ | VM_PROT_EXECUTE);
    __builtin___clear_cache((char*)dst, (char*)dst + n);
    return 0;
}

// arm64 absolute branch: LDR X16,[PC,#8]; BR X16; <target 8 bytes>
static int rbx_hook_branch(void* at, void* target) {
    uint32_t stub[4] = { 0x58000051, 0xD61F0220, 0, 0 };
    uint64_t t = (uint64_t)target;
    memcpy(&stub[2], &t, 8);
    return rbx_patch_bytes(at, stub, sizeof(stub));
}

// -- image base resolution -----------------------------------------------------
static void rbx_find_base(void) {
    uint32_t n = _dyld_image_count();
    for (uint32_t i = 0; i < n; i++) {
        const char* name = _dyld_get_image_name(i);
        if (name && (strstr(name, "/RobloxMobile") || strstr(name, "Roblox.app/Roblox"))) {
            g_image = (void*)_dyld_get_image_header(i);
            g_slide = _dyld_get_image_vmaddr_slide(i);
            return;
        }
    }
    g_image = (void*)_dyld_get_image_header(0);
    g_slide = _dyld_get_image_vmaddr_slide(0);
}

uintptr_t rbx_slide(uintptr_t off) { return (uintptr_t)g_image + off; }

void* rbx_resolve(const char* sym) {
    void* h = dlsym(RTLD_DEFAULT, sym);
    return h;
}

// -- Lua bridge ---------------------------------------------------------------
typedef int (*luaL_loadbuffer_t)(lua_State*, const char*, size_t, const char*);
typedef int (*lua_pcall_t)(lua_State*, int, int, int);
typedef lua_State* (*newstate_t)(void*, void*);

static luaL_loadbuffer_t p_loadbuffer;
static lua_pcall_t       p_pcall;
static lua_State*        g_L = NULL;
static pthread_mutex_t   g_L_mtx = PTHREAD_MUTEX_INITIALIZER;

static newstate_t o_newstate;
static lua_State* h_newstate(void* a, void* b) {
    lua_State* L = o_newstate(a, b);
    pthread_mutex_lock(&g_L_mtx);
    if (!g_L) g_L = L;
    pthread_mutex_unlock(&g_L_mtx);
    return L;
}

void mod_install_lua_bridge(void) {
    p_loadbuffer = (luaL_loadbuffer_t)rbx_slide(g_off.luaL_loadbuffer);
    p_pcall      = (lua_pcall_t)rbx_slide(g_off.lua_pcall);
    o_newstate   = (newstate_t)rbx_slide(g_off.lua_newstate);
    // trap the first Roblox-created state so we can inject from the overlay
    static uint8_t saved[16];
    memcpy(saved, (void*)o_newstate, 16);
    rbx_hook_branch((void*)o_newstate, (void*)&h_newstate);
    (void)saved;
}

void mod_execute_script(const char* src, size_t len) {
    pthread_mutex_lock(&g_L_mtx);
    lua_State* L = g_L;
    pthread_mutex_unlock(&g_L_mtx);
    if (!L || !p_loadbuffer || !p_pcall) return;
    if (p_loadbuffer(L, src, len, "=mod") == 0) {
        p_pcall(L, 0, 0, 0);
    }
}

// -- identity / caller-check bypass -------------------------------------------
// Roblox gates protected globals on an internal identity level (typically 2).
// Patch the check to unconditionally return the elevated level.
static void mod_bypass_identity(void) {
    if (!g_off.identity_check) return;
    // MOV W0,#8 ; RET   (0x52800100, 0xD65F03C0)
    uint32_t patch[2] = { 0x52800100, 0xD65F03C0 };
    rbx_patch_bytes((void*)rbx_slide(g_off.identity_check), patch, sizeof(patch));
}

// -- movement patches ---------------------------------------------------------
static float g_walkspeed = 32.0f;
static float g_jumppower = 100.0f;
static bool  g_noclip    = false;
static bool  g_fly       = false;

typedef void (*humanoid_setstate_t)(void* self, int state);
static humanoid_setstate_t o_humanoid_setstate;

static void h_humanoid_setstate(void* self, int state) {
    // state 15 = physics, 8 = falling — override for fly/noclip
    if (g_fly) state = 4; // Freefall-with-control
    o_humanoid_setstate(self, state);
    // WalkSpeed / JumpPower live at fixed offsets in the Humanoid instance
    *(float*)((uint8_t*)self + 0x2A8) = g_walkspeed;
    *(float*)((uint8_t*)self + 0x2AC) = g_jumppower;
}

void mod_install_walkspeed_patch(void) {
    o_humanoid_setstate = (humanoid_setstate_t)rbx_slide(g_off.humanoid_setstate);
    rbx_hook_branch((void*)o_humanoid_setstate, (void*)&h_humanoid_setstate);
}
void mod_install_jump_patch(void)  { /* covered by setstate hook */ }
void mod_install_noclip(void)      { g_noclip = true; }
void mod_install_fly(void)         { g_fly    = true; }

// -- render overlay (UIKit; injected menu) ------------------------------------
@interface RBXModOverlay : UIView <UITextViewDelegate>
@property (nonatomic, strong) UITextView* editor;
@property (nonatomic, strong) UIButton* run;
@property (nonatomic, strong) UISwitch* flySw;
@property (nonatomic, strong) UISwitch* noclipSw;
@property (nonatomic, strong) UISlider* wsSlider;
@end

@implementation RBXModOverlay
- (instancetype)initWithFrame:(CGRect)f {
    if ((self = [super initWithFrame:f])) {
        self.backgroundColor = [UIColor colorWithWhite:0 alpha:0.82];
        self.layer.cornerRadius = 10;
        _editor = [[UITextView alloc] initWithFrame:CGRectMake(8, 8, f.size.width-16, 180)];
        _editor.backgroundColor = [UIColor colorWithWhite:0.08 alpha:1];
        _editor.textColor = [UIColor greenColor];
        _editor.font = [UIFont fontWithName:@"Menlo" size:11];
        _editor.autocorrectionType = UITextAutocorrectionTypeNo;
        _editor.autocapitalizationType = UITextAutocapitalizationTypeNone;
        _editor.text = @"-- lua here\nprint('injected')";
        [self addSubview:_editor];

        _run = [UIButton buttonWithType:UIButtonTypeSystem];
        _run.frame = CGRectMake(8, 196, 80, 32);
        [_run setTitle:@"Execute" forState:UIControlStateNormal];
        [_run addTarget:self action:@selector(runTapped) forControlEvents:UIControlEventTouchUpInside];
        [self addSubview:_run];

        _flySw = [[UISwitch alloc] initWithFrame:CGRectMake(100, 200, 60, 30)];
        [_flySw addTarget:self action:@selector(flyChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_flySw];

        _noclipSw = [[UISwitch alloc] initWithFrame:CGRectMake(180, 200, 60, 30)];
        [_noclipSw addTarget:self action:@selector(noclipChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_noclipSw];

        _wsSlider = [[UISlider alloc] initWithFrame:CGRectMake(8, 240, f.size.width-16, 30)];
        _wsSlider.minimumValue = 16; _wsSlider.maximumValue = 200; _wsSlider.value = 32;
        [_wsSlider addTarget:self action:@selector(wsChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_wsSlider];

        UIPanGestureRecognizer* pan = [[UIPanGestureRecognizer alloc]
            initWithTarget:self action:@selector(dragged:)];
        [self addGestureRecognizer:pan];
    }
    return self;
}
- (void)runTapped {
    NSString* s = self.editor.text;
    const char* c = [s UTF8String];
    mod_execute_script(c, strlen(c));
}
- (void)flyChanged    { g_fly    = self.flySw.on; }
- (void)noclipChanged { g_noclip = self.noclipSw.on; }
- (void)wsChanged     { g_walkspeed = self.wsSlider.value; }
- (void)dragged:(UIPanGestureRecognizer*)g {
    CGPoint t = [g translationInView:self.superview];
    self.center = CGPointMake(self.center.x + t.x, self.center.y + t.y);
    [g setTranslation:CGPointZero inView:self.superview];
}
@end

static void mod_present_overlay(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindow* w = UIApplication.sharedApplication.keyWindow;
        if (!w) {
            for (UIScene* s in UIApplication.sharedApplication.connectedScenes) {
                if ([s isKindOfClass:UIWindowScene.class]) {
                    w = ((UIWindowScene*)s).windows.firstObject;
                    if (w) break;
                }
            }
        }
        if (!w) return;
        RBXModOverlay* v = [[RBXModOverlay alloc]
            initWithFrame:CGRectMake(20, 80, 340, 280)];
        [w addSubview:v];
    });
}

void mod_install_render_overlay(void) {
    mod_present_overlay();
}

// -- entry --------------------------------------------------------------------
void mod_init(void* image_base) {
    rbx_find_base();
    mod_bypass_identity();
    mod_install_lua_bridge();
    mod_install_walkspeed_patch();
    mod_install_render_overlay();
}
