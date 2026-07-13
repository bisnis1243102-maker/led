// Cross-target hook core — same TU compiled into the Theos tweak (.dylib)
// and linked into the patched-IPA companion dylib injected via LC_LOAD_DYLIB.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <mach/mach.h>
#include <sys/mman.h>
#include <libkern/OSCacheControl.h>
#include <dlfcn.h>
#include <pthread.h>
#include <string.h>
#include "hooks.h"

struct RobloxOffsets g_off;
uintptr_t g_off_lua_state_namecall   = 0x60;
uintptr_t g_off_lua_state_global     = 0x18;
uintptr_t g_off_global_allgcopages   = 0x40;
uintptr_t g_off_gco_next             = 0x00;
uintptr_t g_off_gco_tt               = 0x08;
uintptr_t g_off_tstring_data         = 0x18;
uintptr_t g_off_closure_isC          = 0x0A;
uintptr_t g_off_closure_nup          = 0x0B;
uintptr_t g_off_closure_l_p          = 0x28;
uintptr_t g_off_closure_c_f          = 0x28;
uintptr_t g_off_instance_children    = 0x50;
uintptr_t g_off_instance_parent      = 0x40;
uintptr_t g_off_instance_classname   = 0x08;
uintptr_t g_off_signal_head          = 0x18;
uintptr_t g_off_conn_next            = 0x00;
uintptr_t g_off_conn_state           = 0x08;
uintptr_t g_off_conn_fn              = 0x10;

extern "C" void antidetect_install(void);
extern "C" void roblox_globals_install(lua_State*);
extern "C" void autoexec_run(void);
extern "C" void debug_lib_install(lua_State*);
extern "C" void crypt_lib_install(lua_State*);
extern "C" void drawing_lib_install(lua_State*);
extern "C" void sched_set_main(lua_State*);
extern "C" void sched_execute(const char*, size_t);
extern "C" void sched_tick(void);

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
    sys_icache_invalidate((void*)dst, n);
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

extern "C" void executor_install(lua_State*);
extern "C" void executor_mark_thread(lua_State*);

static luaL_loadbuffer_t p_loadbuffer;
static lua_pcall_t       p_pcall;
static lua_State*        g_L = NULL;
static pthread_mutex_t   g_L_mtx = PTHREAD_MUTEX_INITIALIZER;

static newstate_t o_newstate;
static lua_State* h_newstate(void* a, void* b) {
    lua_State* L = o_newstate(a, b);
    pthread_mutex_lock(&g_L_mtx);
    if (!g_L) {
        g_L = L;
        executor_install(L);
        roblox_globals_install(L);
        debug_lib_install(L);
        crypt_lib_install(L);
        drawing_lib_install(L);
        sched_set_main(L);
        autoexec_run();
    }
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
    // Route through scheduler so yielding scripts (wait/task.wait/coroutines)
    // resume on the game thread instead of deadlocking on whoever tapped Execute.
    sched_execute(src, len);
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

// -- TaskScheduler::step hook — drains the coroutine ready queue per frame ---
typedef void (*step_t)(void* self);
static step_t o_step = NULL;
static void h_step(void* self) {
    o_step(self);
    sched_tick();
}
static void mod_install_scheduler_hook(void) {
    if (!g_off.task_scheduler_step) return;
    o_step = (step_t)rbx_slide(g_off.task_scheduler_step);
    rbx_hook_branch((void*)o_step, (void*)&h_step);
}
void mod_install_jump_patch(void)  { /* covered by setstate hook */ }
void mod_install_noclip(void)      { g_noclip = true; }
void mod_install_fly(void)         { g_fly    = true; }

// -- render overlay (UIKit; injected menu) ------------------------------------
@interface RBXModOverlay : UIView <UITextViewDelegate, UITableViewDataSource, UITableViewDelegate>
@property (nonatomic, strong) UITextView* editor;
@property (nonatomic, strong) UIButton* run;
@property (nonatomic, strong) UIButton* save;
@property (nonatomic, strong) UIButton* clear;
@property (nonatomic, strong) UIButton* min;
@property (nonatomic, strong) UIButton* scripts;
@property (nonatomic, strong) UISwitch* flySw;
@property (nonatomic, strong) UISwitch* noclipSw;
@property (nonatomic, strong) UISlider* wsSlider;
@property (nonatomic, strong) UILabel* wsLabel;
@property (nonatomic, strong) UITableView* scriptList;
@property (nonatomic, strong) NSMutableArray<NSString*>* scriptFiles;
@property (nonatomic, assign) BOOL minimized;
@end

static NSString* rbxmod_scripts_dir(void) {
    NSString* docs = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSString* d = [docs stringByAppendingPathComponent:@"RobloxMod/scripts"];
    [NSFileManager.defaultManager createDirectoryAtPath:d
        withIntermediateDirectories:YES attributes:nil error:nil];
    return d;
}

@implementation RBXModOverlay
- (instancetype)initWithFrame:(CGRect)f {
    if ((self = [super initWithFrame:f])) {
        self.backgroundColor = [UIColor colorWithWhite:0 alpha:0.86];
        self.layer.cornerRadius = 10;
        self.layer.borderColor  = [UIColor colorWithRed:0.2 green:0.9 blue:0.3 alpha:1].CGColor;
        self.layer.borderWidth  = 1.0;

        UILabel* title = [[UILabel alloc] initWithFrame:CGRectMake(10, 4, 200, 20)];
        title.text = @"RobloxMod"; title.textColor = UIColor.whiteColor;
        title.font = [UIFont boldSystemFontOfSize:12];
        [self addSubview:title];

        _min = [UIButton buttonWithType:UIButtonTypeSystem];
        _min.frame = CGRectMake(f.size.width - 30, 2, 26, 26);
        [_min setTitle:@"–" forState:UIControlStateNormal];
        [_min addTarget:self action:@selector(toggleMin) forControlEvents:UIControlEventTouchUpInside];
        [self addSubview:_min];

        _editor = [[UITextView alloc] initWithFrame:CGRectMake(8, 28, f.size.width-16, 170)];
        _editor.backgroundColor = [UIColor colorWithWhite:0.08 alpha:1];
        _editor.textColor = [UIColor colorWithRed:0.4 green:1.0 blue:0.5 alpha:1];
        _editor.font = [UIFont fontWithName:@"Menlo" size:11];
        _editor.autocorrectionType = UITextAutocorrectionTypeNo;
        _editor.autocapitalizationType = UITextAutocapitalizationTypeNone;
        _editor.text = @"-- getrawmetatable(game), hookfunction, request{}...\nprint(identifyexecutor())";
        [self addSubview:_editor];

        _run   = [self mkBtn:@"Execute" frame:CGRectMake(8,   204, 80, 30) sel:@selector(runTapped)];
        _save  = [self mkBtn:@"Save"    frame:CGRectMake(92,  204, 60, 30) sel:@selector(saveTapped)];
        _clear = [self mkBtn:@"Clear"   frame:CGRectMake(156, 204, 60, 30) sel:@selector(clearTapped)];
        _scripts = [self mkBtn:@"Scripts" frame:CGRectMake(220, 204, 55, 30) sel:@selector(scriptsTapped)];
        [self mkBtn:@"Hub" frame:CGRectMake(279, 204, 45, 30) sel:@selector(hubTapped)];

        UILabel* flyL = [[UILabel alloc] initWithFrame:CGRectMake(8, 242, 40, 26)];
        flyL.text = @"Fly"; flyL.textColor = UIColor.whiteColor; flyL.font = [UIFont systemFontOfSize:11];
        [self addSubview:flyL];
        _flySw = [[UISwitch alloc] initWithFrame:CGRectMake(44, 240, 50, 28)];
        _flySw.transform = CGAffineTransformMakeScale(0.75, 0.75);
        [_flySw addTarget:self action:@selector(flyChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_flySw];

        UILabel* ncL = [[UILabel alloc] initWithFrame:CGRectMake(110, 242, 50, 26)];
        ncL.text = @"Noclip"; ncL.textColor = UIColor.whiteColor; ncL.font = [UIFont systemFontOfSize:11];
        [self addSubview:ncL];
        _noclipSw = [[UISwitch alloc] initWithFrame:CGRectMake(158, 240, 50, 28)];
        _noclipSw.transform = CGAffineTransformMakeScale(0.75, 0.75);
        [_noclipSw addTarget:self action:@selector(noclipChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_noclipSw];

        _wsLabel = [[UILabel alloc] initWithFrame:CGRectMake(8, 274, f.size.width-16, 18)];
        _wsLabel.text = @"WalkSpeed: 32"; _wsLabel.textColor = UIColor.whiteColor;
        _wsLabel.font = [UIFont systemFontOfSize:11];
        [self addSubview:_wsLabel];
        _wsSlider = [[UISlider alloc] initWithFrame:CGRectMake(8, 292, f.size.width-16, 26)];
        _wsSlider.minimumValue = 16; _wsSlider.maximumValue = 200; _wsSlider.value = 32;
        [_wsSlider addTarget:self action:@selector(wsChanged) forControlEvents:UIControlEventValueChanged];
        [self addSubview:_wsSlider];

        _scriptList = [[UITableView alloc] initWithFrame:
            CGRectMake(0, 28, f.size.width, f.size.height - 28) style:UITableViewStylePlain];
        _scriptList.backgroundColor = [UIColor colorWithWhite:0.05 alpha:1];
        _scriptList.dataSource = self; _scriptList.delegate = self;
        _scriptList.hidden = YES;
        [self addSubview:_scriptList];

        UIPanGestureRecognizer* pan = [[UIPanGestureRecognizer alloc]
            initWithTarget:self action:@selector(dragged:)];
        [self addGestureRecognizer:pan];

        NSNotificationCenter* nc = NSNotificationCenter.defaultCenter;
        [nc addObserver:self selector:@selector(kbShow:)
                   name:UIKeyboardWillShowNotification object:nil];
        [nc addObserver:self selector:@selector(kbHide:)
                   name:UIKeyboardWillHideNotification object:nil];
    }
    return self;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)kbShow:(NSNotification*)n {
    CGRect kb = [n.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
    UIWindow* w = self.window;
    if (!w) return;
    CGRect kbInWin = [w convertRect:kb fromWindow:nil];
    CGFloat myBottom = CGRectGetMaxY(self.frame);
    CGFloat overlap = myBottom - kbInWin.origin.y;
    if (overlap <= 0) return;
    NSTimeInterval dur = [n.userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
    self.tag = (NSInteger)overlap; // stash so kbHide can reverse
    [UIView animateWithDuration:dur animations:^{
        CGRect f = self.frame;
        f.origin.y -= overlap + 8;
        self.frame = f;
    }];
}

- (void)kbHide:(NSNotification*)n {
    if (!self.tag) return;
    NSTimeInterval dur = [n.userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
    CGFloat back = (CGFloat)self.tag + 8;
    self.tag = 0;
    [UIView animateWithDuration:dur animations:^{
        CGRect f = self.frame;
        f.origin.y += back;
        self.frame = f;
    }];
}

- (UIButton*)mkBtn:(NSString*)t frame:(CGRect)f sel:(SEL)s {
    UIButton* b = [UIButton buttonWithType:UIButtonTypeSystem];
    b.frame = f;
    b.backgroundColor = [UIColor colorWithWhite:0.15 alpha:1];
    b.layer.cornerRadius = 5;
    [b setTitle:t forState:UIControlStateNormal];
    b.titleLabel.font = [UIFont systemFontOfSize:12];
    [b addTarget:self action:s forControlEvents:UIControlEventTouchUpInside];
    [self addSubview:b];
    return b;
}

- (void)runTapped {
    NSString* s = self.editor.text;
    const char* c = [s UTF8String];
    mod_execute_script(c, strlen(c));
}
- (void)saveTapped {
    NSString* name = [NSString stringWithFormat:@"script_%ld.lua",
        (long)[NSDate.date timeIntervalSince1970]];
    NSString* p = [rbxmod_scripts_dir() stringByAppendingPathComponent:name];
    [self.editor.text writeToFile:p atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (void)clearTapped { self.editor.text = @""; }

- (void)scriptsTapped {
    if (!self.scriptList.hidden) {
        self.scriptList.hidden = YES;
        return;
    }
    self.scriptFiles = [NSMutableArray array];
    for (NSString* it in [NSFileManager.defaultManager
            contentsOfDirectoryAtPath:rbxmod_scripts_dir() error:nil]) {
        if ([it hasSuffix:@".lua"] || [it hasSuffix:@".luau"] || [it hasSuffix:@".txt"])
            [self.scriptFiles addObject:it];
    }
    [self.scriptList reloadData];
    self.scriptList.hidden = NO;
}

- (NSInteger)tableView:(UITableView*)tv numberOfRowsInSection:(NSInteger)s {
    return self.scriptFiles.count;
}
- (UITableViewCell*)tableView:(UITableView*)tv cellForRowAtIndexPath:(NSIndexPath*)ip {
    UITableViewCell* c = [tv dequeueReusableCellWithIdentifier:@"c"];
    if (!c) c = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:@"c"];
    c.backgroundColor = UIColor.clearColor;
    c.textLabel.textColor = UIColor.whiteColor;
    c.textLabel.font = [UIFont fontWithName:@"Menlo" size:11];
    c.textLabel.text = self.scriptFiles[ip.row];
    return c;
}
- (void)tableView:(UITableView*)tv didSelectRowAtIndexPath:(NSIndexPath*)ip {
    NSString* p = [rbxmod_scripts_dir() stringByAppendingPathComponent:self.scriptFiles[ip.row]];
    self.editor.text = [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:nil] ?: @"";
    self.scriptList.hidden = YES;
}

- (void)hubTapped {
    // Script-hub catalog URL. Points at a JSON manifest:
    //   [ {"name": "...", "url": "https://.../script.lua"}, ... ]
    NSString* catalogUrl = [NSUserDefaults.standardUserDefaults
        stringForKey:@"RobloxMod.HubUrl"] ?:
        @"https://raw.githubusercontent.com/bisnis1243102-maker/led/main/hub/catalog.json";
    NSURL* url = [NSURL URLWithString:catalogUrl];
    [[NSURLSession.sharedSession dataTaskWithURL:url
        completionHandler:^(NSData* d, NSURLResponse* r, NSError* e) {
            if (!d) return;
            NSArray* items = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
            if (![items isKindOfClass:NSArray.class]) return;
            dispatch_async(dispatch_get_main_queue(), ^{
                UIAlertController* ac = [UIAlertController
                    alertControllerWithTitle:@"Hub" message:nil
                              preferredStyle:UIAlertControllerStyleActionSheet];
                for (NSDictionary* it in items) {
                    NSString* name = it[@"name"]; NSString* u = it[@"url"];
                    if (!name || !u) continue;
                    [ac addAction:[UIAlertAction actionWithTitle:name
                        style:UIAlertActionStyleDefault
                        handler:^(UIAlertAction* a){
                            [[NSURLSession.sharedSession dataTaskWithURL:[NSURL URLWithString:u]
                                completionHandler:^(NSData* sd, NSURLResponse* sr, NSError* se){
                                    if (!sd) return;
                                    mod_execute_script((const char*)sd.bytes, sd.length);
                                }] resume];
                        }]];
                }
                [ac addAction:[UIAlertAction actionWithTitle:@"Cancel"
                    style:UIAlertActionStyleCancel handler:nil]];
                UIViewController* root = self.window.rootViewController;
                while (root.presentedViewController) root = root.presentedViewController;
                ac.popoverPresentationController.sourceView = self;
                ac.popoverPresentationController.sourceRect = self.bounds;
                [root presentViewController:ac animated:YES completion:nil];
            });
        }] resume];
}

- (void)toggleMin {
    self.minimized = !self.minimized;
    CGRect f = self.frame;
    if (self.minimized) {
        f.size.height = 28;
        [self.min setTitle:@"+" forState:UIControlStateNormal];
    } else {
        f.size.height = 328;
        [self.min setTitle:@"–" forState:UIControlStateNormal];
    }
    [UIView animateWithDuration:0.2 animations:^{ self.frame = f; }];
}

- (void)flyChanged    { g_fly    = self.flySw.on; }
- (void)noclipChanged { g_noclip = self.noclipSw.on; }
- (void)wsChanged {
    g_walkspeed = self.wsSlider.value;
    self.wsLabel.text = [NSString stringWithFormat:@"WalkSpeed: %.0f", g_walkspeed];
}
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
            initWithFrame:CGRectMake(20, 80, 340, 328)];
        [w addSubview:v];
    });
}

void mod_install_render_overlay(void) {
    mod_present_overlay();
}

// -- entry --------------------------------------------------------------------
void mod_init(void* image_base) {
    rbx_find_base();
    antidetect_install();       // hide our dylib from dyld enumeration first
    mod_bypass_identity();
    mod_install_lua_bridge();
    mod_install_walkspeed_patch();
    mod_install_scheduler_hook();
    mod_install_render_overlay();
}
