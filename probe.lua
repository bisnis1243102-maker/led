-- RobloxMod struct-offset probe. Paste into the executor overlay after
-- injection to validate the offset table against the current Roblox build.
-- All lines should print sane values; nils / crashes indicate the offset
-- needs to be re-derived for this client version.

print("== RobloxMod probe ==")
print("executor:", identifyexecutor())
print("checkcaller:", checkcaller())

-- getgenv persistence
getgenv()._probe = (getgenv()._probe or 0) + 1
print("genv counter:", getgenv()._probe)

-- getrenv sanity
local renv = getrenv()
print("renv.game:", tostring(renv.game))

-- getgc walk — should return a large number if the global_State offsets are right
local gc = getgc(true)
print("getgc(true) count:", #gc)
-- classify the first 200 for a rough type breakdown
local counts = {["function"]=0, ["table"]=0, ["userdata"]=0}
for i = 1, math.min(#gc, 200) do
    local t = type(gc[i])
    counts[t] = (counts[t] or 0) + 1
end
print("gc sample types:", counts["function"], counts["table"], counts["userdata"])

-- getrawmetatable + __namecall probe
local mt = getrawmetatable(game)
print("mt(game):", type(mt))
if mt then
    local was = getreadonly and getreadonly(mt)
    if setreadonly then setreadonly(mt, false) end
    local orig = mt.__namecall
    if type(orig) == "function" then
        hookmetamethod(game, "__namecall", function(self, ...)
            local m = getnamecallmethod()
            if m == "__probe_marker__" then
                return "hook_worked"
            end
            return orig(self, ...)
        end)
        local ok, res = pcall(function() return game:__probe_marker__() end)
        print("namecall hook:", ok, res)
    end
end

-- filesystem sandbox
writefile("probe.txt", "hello")
print("readfile:", readfile("probe.txt"))
print("isfile:", isfile("probe.txt"))
delfile("probe.txt")

-- HTTP
local resp = request({Url="https://httpbin.org/get", Method="GET"})
print("http status:", resp.StatusCode, "body bytes:", #(resp.Body or ""))

-- hookfunction proto-swap smoke test
local function tgt() return "orig" end
local orig = hookfunction(tgt, function() return "hooked" end)
print("hookfunction:", tgt(), "orig:", orig and orig())

print("== probe done ==")
