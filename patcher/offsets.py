"""
Roblox iOS client offset table.

Offsets are VMADDR file offsets from the __TEXT segment start of the main
Mach-O binary inside Roblox.app. Update per release — Roblox ships weekly.

Populate with IDA/Ghidra/Binja after signature-matching against known
Luau symbols. Sigs kept here for auto-recovery when offsets rot.
"""

# Latest tracked client at time of writing — bump `VERSION` string and
# re-run patcher/find_offsets.py against a fresh IPA to refresh.
VERSION = "2.660.xxxxx"   # replace with the exact CFBundleVersion of the IPA

# All offsets are file-offsets into the sliced arm64e Mach-O.
OFFSETS = {
    "lua_newstate":          0x00000000,  # luaL_newstate wrapper
    "lua_pcall":             0x00000000,
    "luaL_loadbuffer":       0x00000000,
    "task_scheduler_step":   0x00000000,
    "humanoid_setstate":     0x00000000,
    "datamodel_open":        0x00000000,
    "script_context_resume": 0x00000000,
    "print_hook":            0x00000000,
    "identity_check":        0x00000000,
    "luau_compile":          0x00000000,  # bundled compiler entry
}

# Luau lua_State / global_State struct field offsets. These are compiler-
# dependent (Roblox builds Luau with -Os arm64e) — verify per release by
# cross-referencing lua_pcall's prologue register saves and getnamecallmethod
# targets.
STRUCT = {
    "lua_State.namecall":        0x60,  # TString* current namecall method
    "lua_State.global":          0x18,  # global_State*
    "global_State.strt":         0x00,  # string table (for GC walk seed)
    "global_State.allgcopages":  0x40,  # linked list of GC object pages
    "GCO.next":                  0x00,  # generic GCObject next ptr
    "GCO.tt":                    0x08,  # type tag
    "TString.data":              0x18,  # char[] payload
    "Closure.isC":               0x0A,  # uint8_t — 1 if C closure
    "Closure.nupvalues":         0x0B,  # uint8_t
    "Closure.env":               0x18,  # Table*
    "Closure.l.p":               0x28,  # Proto* for Lua closures
    "Closure.c.f":               0x28,  # lua_CFunction for C closures
    "Closure.c.cont":            0x30,  # lua_Continuation
    "Closure.c.debugname":       0x38,  # const char*
}


# Byte-signatures (AOB) for auto-recovery when the client is repacked.
# Wildcards use '??'. Hits are validated against xref counts.
SIGS = {
    "lua_pcall":         "FF 43 01 D1 F4 4F 01 A9 FD 7B 02 A9 FD 83 00 91",
    "luaL_loadbuffer":   "FF 83 01 D1 FD 7B 03 A9 FD C3 00 91 F4 4F 04 A9",
    "humanoid_setstate": "F8 5F BC A9 F6 57 01 A9 F4 4F 02 A9 FD 7B 03 A9",
    "identity_check":    "FF C3 00 D1 FD 7B 01 A9 FD 43 00 91 08 00 40 F9",
}
