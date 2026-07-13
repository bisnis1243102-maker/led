// Bridge from the executor's loadstring path to the bundled Luau compiler.
// Falls back to the client's own symbol when present, uses the static lib
// otherwise. Signature matches what executor_lib.mm calls via dlsym.
#include <stdlib.h>
#include <string.h>
#include <string>

// Forward decls from Luau's Compiler.h so we don't drag the header into every TU.
namespace Luau {
    struct CompileOptions {
        int optimizationLevel = 1;
        int debugLevel = 1;
        int typeInfoLevel = 0;
        int coverageLevel = 0;
        const char* vectorLib = nullptr;
        const char* vectorCtor = nullptr;
        const char* vectorType = nullptr;
        const char* const* mutableGlobals = nullptr;
        const char* const* userdataTypes = nullptr;
    };
    std::string compile(const std::string& src, const CompileOptions& opts = {});
}

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
