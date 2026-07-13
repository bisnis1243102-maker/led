// Theos logos tweak — jailbroken target (substitute / ellekit / substrate).
// Loads on Roblox launch, kicks the shared hook core.

#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>
#include "../shared/hooks.h"

%ctor {
    @autoreleasepool {
        NSString* bid = NSBundle.mainBundle.bundleIdentifier;
        if (![bid isEqualToString:@"com.roblox.robloxmobile"]) return;
        // Defer until UIApplication is up so the overlay has a window
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)),
            dispatch_get_main_queue(), ^{
                mod_init(NULL);
            });
    }
}
