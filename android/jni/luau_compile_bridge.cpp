#include <stdlib.h>
#include <string.h>
#include <string>
#include "Luau/Compiler.h"

extern "C" char* luau_compile_bundled(const char* src, size_t srclen,
                                      void* /*opts*/, size_t* outlen) {
    try {
        Luau::CompileOptions opts;
        opts.optimizationLevel = 1;
        opts.debugLevel = 1;
        std::string bc = Luau::compile(std::string(src, srclen), opts);
        char* out = (char*)malloc(bc.size());
        if (!out) { *outlen = 0; return nullptr; }
        memcpy(out, bc.data(), bc.size());
        *outlen = bc.size();
        return out;
    } catch (...) {
        *outlen = 0;
        return nullptr;
    }
}
