TARGET := iphone:clang:latest:15.0
ARCHS  := arm64 arm64e
INSTALL_TARGET_PROCESSES = Roblox

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = RobloxMod
RobloxMod_FILES         = Tweak.x ../shared/hooks.mm
RobloxMod_CFLAGS        = -fobjc-arc -Wno-deprecated-declarations -I../shared
RobloxMod_CCFLAGS       = -std=c++17
RobloxMod_FRAMEWORKS    = UIKit Foundation QuartzCore
RobloxMod_PRIVATE_FRAMEWORKS =

include $(THEOS_MAKE_PATH)/tweak.mk

after-install::
	install.exec "killall -9 Roblox || true"
