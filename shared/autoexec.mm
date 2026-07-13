// Auto-execute — run every .lua/.luau file under Documents/RobloxMod/autoexec
// on world load. Fires from mod_execute_script after state capture; also
// drains the teleport queue populated by queue_on_teleport.
#import <Foundation/Foundation.h>
#include <string.h>
#include "hooks.h"

static NSString* autoexec_dir(void) {
    NSString* docs = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSString* d = [docs stringByAppendingPathComponent:@"RobloxMod/autoexec"];
    [NSFileManager.defaultManager createDirectoryAtPath:d
        withIntermediateDirectories:YES attributes:nil error:nil];
    return d;
}

extern "C" void autoexec_run(void) {
    NSString* dir = autoexec_dir();
    NSArray* items = [[NSFileManager.defaultManager
        contentsOfDirectoryAtPath:dir error:nil]
        sortedArrayUsingSelector:@selector(compare:)];
    for (NSString* it in items) {
        if (!([it hasSuffix:@".lua"] || [it hasSuffix:@".luau"])) continue;
        NSString* p = [dir stringByAppendingPathComponent:it];
        NSData* d = [NSData dataWithContentsOfFile:p];
        if (d) mod_execute_script((const char*)d.bytes, d.length);
    }
    // Drain teleport queue
    NSString* docs = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSString* q = [docs stringByAppendingPathComponent:@"RobloxMod/teleport_queue.lua"];
    NSData* qd = [NSData dataWithContentsOfFile:q];
    if (qd) {
        mod_execute_script((const char*)qd.bytes, qd.length);
        [NSFileManager.defaultManager removeItemAtPath:q error:nil];
    }
}
