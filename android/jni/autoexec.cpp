#include <dirent.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include "hooks_android.h"

extern "C" void autoexec_run(void) {
    const char* dir = "/sdcard/Android/data/com.roblox.client/files/RobloxMod/autoexec";
    mkdir("/sdcard/Android/data/com.roblox.client/files/RobloxMod", 0755);
    mkdir(dir, 0755);
    DIR* d = opendir(dir);
    if (!d) return;
    struct dirent* e;
    while ((e = readdir(d))) {
        const char* n = e->d_name;
        size_t l = strlen(n);
        if (l < 5) continue;
        if (strcmp(n + l - 4, ".lua") != 0 &&
            strcmp(n + l - 5, ".luau") != 0) continue;
        char path[1024];
        snprintf(path, sizeof(path), "%s/%s", dir, n);
        FILE* f = fopen(path, "rb");
        if (!f) continue;
        fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
        char* buf = (char*)malloc(sz);
        fread(buf, 1, sz, f); fclose(f);
        mod_execute_script(buf, sz);
        free(buf);
    }
    closedir(d);
}
