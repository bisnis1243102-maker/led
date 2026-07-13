// Drawing library — 2D overlay primitives (Line, Circle, Square, Text, Quad,
// Triangle). Backed by a single overlay UIView whose layer hosts CAShapeLayer /
// CATextLayer nodes. Each Drawing.new returns a lightuserdata-tagged table
// whose fields mutate the underlying layer on assignment.
#import <UIKit/UIKit.h>
#include <string.h>
#include "luau_shim.h"

// -- overlay window -----------------------------------------------------------
static UIWindow* g_drawWin = nil;

static UIWindow* drawing_window(void) {
    if (g_drawWin) return g_drawWin;
    dispatch_sync(dispatch_get_main_queue(), ^{
        UIScreen* scr = UIScreen.mainScreen;
        g_drawWin = [[UIWindow alloc] initWithFrame:scr.bounds];
        g_drawWin.windowLevel = UIWindowLevelStatusBar + 100;
        g_drawWin.userInteractionEnabled = NO;
        g_drawWin.rootViewController = [UIViewController new];
        g_drawWin.hidden = NO;
    });
    return g_drawWin;
}

// -- object registry ---------------------------------------------------------
typedef struct { CALayer* layer; int kind; } DrawObj;
enum { D_LINE=1, D_CIRCLE, D_SQUARE, D_TEXT, D_QUAD, D_TRIANGLE };

static DrawObj* drawobj_new(int kind) {
    DrawObj* o = (DrawObj*)calloc(1, sizeof(DrawObj));
    o->kind = kind;
    return o;
}

static void apply_common(DrawObj* o, lua_State* S) {
    // Set From / To / Position / Size / Color / Thickness / Visible / Text /
    // TextSize / Filled off the table on top of stack.
    L.getfield(S, -1, "Visible");
    o->layer.hidden = !L.toboolean(S, -1);
    L.pop(S, 1);
    L.getfield(S, -1, "Color");
    // color as {r,g,b} table
    if (L.type(S, -1) == LUA_TTABLE) {
        L.rawgeti(S, -1, 1); double r = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S, -1, 2); double g = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S, -1, 3); double b = L.tonumberx(S,-1,NULL); L.pop(S,1);
        UIColor* c = [UIColor colorWithRed:r green:g blue:b alpha:1];
        if ([o->layer isKindOfClass:CAShapeLayer.class]) {
            ((CAShapeLayer*)o->layer).strokeColor = c.CGColor;
            ((CAShapeLayer*)o->layer).fillColor = UIColor.clearColor.CGColor;
        } else if ([o->layer isKindOfClass:CATextLayer.class]) {
            ((CATextLayer*)o->layer).foregroundColor = c.CGColor;
        } else {
            o->layer.backgroundColor = c.CGColor;
        }
    }
    L.pop(S, 1);
}

// Drawing.new("Line" | "Circle" | "Square" | "Text" | "Quad" | "Triangle")
static int dr_new(lua_State* S) {
    const char* kind = L.L_checklstring(S, 1, NULL);
    int k = 0;
    if (!strcasecmp(kind, "Line")) k = D_LINE;
    else if (!strcasecmp(kind, "Circle")) k = D_CIRCLE;
    else if (!strcasecmp(kind, "Square")) k = D_SQUARE;
    else if (!strcasecmp(kind, "Text")) k = D_TEXT;
    else if (!strcasecmp(kind, "Quad")) k = D_QUAD;
    else if (!strcasecmp(kind, "Triangle")) k = D_TRIANGLE;
    else { L.pushnil(S); return 1; }

    DrawObj* o = drawobj_new(k);
    dispatch_sync(dispatch_get_main_queue(), ^{
        UIWindow* w = drawing_window();
        if (k == D_TEXT) {
            CATextLayer* t = [CATextLayer layer];
            t.fontSize = 12; t.contentsScale = UIScreen.mainScreen.scale;
            t.foregroundColor = UIColor.whiteColor.CGColor;
            o->layer = t;
        } else if (k == D_LINE || k == D_CIRCLE || k == D_QUAD || k == D_TRIANGLE) {
            CAShapeLayer* sh = [CAShapeLayer layer];
            sh.strokeColor = UIColor.whiteColor.CGColor;
            sh.fillColor = UIColor.clearColor.CGColor;
            sh.lineWidth = 1.0;
            o->layer = sh;
        } else { // SQUARE
            o->layer = [CALayer layer];
            o->layer.backgroundColor = UIColor.whiteColor.CGColor;
        }
        o->layer.frame = w.bounds;
        [w.layer addSublayer:o->layer];
    });

    // Return userdata { __obj = light, Update = fn, Remove = fn }
    L.createtable(S, 0, 6);
    L.pushlightuserdata(S, o);
    L.setfield(S, -2, "__obj");

    // fields: default visible true
    L.pushboolean(S, 1); L.setfield(S, -2, "Visible");
    L.pushnumber(S, 1);  L.setfield(S, -2, "Thickness");
    return 1;
}

// Drawing:Update(obj) — re-reads fields off the table and applies to layer.
static int dr_update(lua_State* S) {
    L.getfield(S, 1, "__obj");
    DrawObj* o = (DrawObj*)L.touserdata(S, -1);
    L.pop(S, 1);
    if (!o) return 0;

    __block CGFloat fromX=0, fromY=0, toX=0, toY=0, radius=0, sizeW=0, sizeH=0, thick=1;
    __block const char* text = NULL;
    L.getfield(S, 1, "From");
    if (L.type(S,-1) == LUA_TTABLE) {
        L.rawgeti(S,-1,1); fromX = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S,-1,2); fromY = L.tonumberx(S,-1,NULL); L.pop(S,1);
    } L.pop(S,1);
    L.getfield(S, 1, "To");
    if (L.type(S,-1) == LUA_TTABLE) {
        L.rawgeti(S,-1,1); toX = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S,-1,2); toY = L.tonumberx(S,-1,NULL); L.pop(S,1);
    } L.pop(S,1);
    L.getfield(S, 1, "Position");
    if (L.type(S,-1) == LUA_TTABLE) {
        L.rawgeti(S,-1,1); fromX = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S,-1,2); fromY = L.tonumberx(S,-1,NULL); L.pop(S,1);
    } L.pop(S,1);
    L.getfield(S, 1, "Size");
    if (L.type(S,-1) == LUA_TTABLE) {
        L.rawgeti(S,-1,1); sizeW = L.tonumberx(S,-1,NULL); L.pop(S,1);
        L.rawgeti(S,-1,2); sizeH = L.tonumberx(S,-1,NULL); L.pop(S,1);
    } else if (L.type(S,-1) == LUA_TNUMBER) {
        sizeW = sizeH = L.tonumberx(S,-1,NULL);
    } L.pop(S,1);
    L.getfield(S, 1, "Radius");   radius = L.tonumberx(S,-1,NULL); L.pop(S,1);
    L.getfield(S, 1, "Thickness"); thick = L.tonumberx(S,-1,NULL) ?: 1; L.pop(S,1);
    L.getfield(S, 1, "Text");     text = L.tolstring(S,-1,NULL); L.pop(S,1);
    NSString* nsText = text ? [NSString stringWithUTF8String:text] : nil;

    int kind = o->kind;
    CALayer* layer = o->layer;

    dispatch_async(dispatch_get_main_queue(), ^{
        if (kind == D_LINE) {
            CAShapeLayer* sh = (CAShapeLayer*)layer;
            UIBezierPath* p = [UIBezierPath bezierPath];
            [p moveToPoint:CGPointMake(fromX, fromY)];
            [p addLineToPoint:CGPointMake(toX, toY)];
            sh.path = p.CGPath;
            sh.lineWidth = thick;
        } else if (kind == D_CIRCLE) {
            CAShapeLayer* sh = (CAShapeLayer*)layer;
            UIBezierPath* p = [UIBezierPath bezierPathWithArcCenter:
                CGPointMake(fromX, fromY) radius:radius startAngle:0
                endAngle:2*M_PI clockwise:YES];
            sh.path = p.CGPath;
            sh.lineWidth = thick;
        } else if (kind == D_SQUARE) {
            layer.frame = CGRectMake(fromX, fromY, sizeW, sizeH);
        } else if (kind == D_TEXT) {
            CATextLayer* t = (CATextLayer*)layer;
            t.string = nsText;
            t.frame = CGRectMake(fromX, fromY, 400, 20);
        }
        // apply Color/Visible off the table
    });
    // read Color/Visible via apply_common
    L.pushvalue(S, 1);
    apply_common(o, S);
    L.pop(S, 1);
    return 0;
}

// Drawing:Remove(obj)
static int dr_remove(lua_State* S) {
    L.getfield(S, 1, "__obj");
    DrawObj* o = (DrawObj*)L.touserdata(S, -1);
    L.pop(S, 1);
    if (!o) return 0;
    dispatch_async(dispatch_get_main_queue(), ^{
        [o->layer removeFromSuperlayer];
        free(o);
    });
    return 0;
}

// Drawing:Clear() — remove all drawing layers
static int dr_clear(lua_State* S) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindow* w = drawing_window();
        for (CALayer* l in [w.layer.sublayers copy]) [l removeFromSuperlayer];
    });
    return 0;
}

extern "C" void drawing_lib_install(lua_State* S) {
    L.createtable(S, 0, 4);
    L.pushcclosurek(S, dr_new,    "new",    0, NULL); L.setfield(S, -2, "new");
    L.pushcclosurek(S, dr_update, "Update", 0, NULL); L.setfield(S, -2, "Update");
    L.pushcclosurek(S, dr_remove, "Remove", 0, NULL); L.setfield(S, -2, "Remove");
    L.pushcclosurek(S, dr_clear,  "Clear",  0, NULL); L.setfield(S, -2, "Clear");
    lua_setglobal(S, "Drawing");
}
