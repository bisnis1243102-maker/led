// crypt.* — base64, hash (MD5/SHA1/SHA256/SHA384/SHA512), encrypt/decrypt
// (AES-256-CBC with random IV, urlsafe base64 output), generatebytes,
// generatekey. Backed by CommonCrypto.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonCrypto.h>
#include <CommonCrypto/CommonRandom.h>
#include <string.h>
#include "luau_shim.h"

static NSString* b64_encode(NSData* d, BOOL urlsafe) {
    NSString* s = [d base64EncodedStringWithOptions:0];
    if (urlsafe) {
        s = [s stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
        s = [s stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
        s = [s stringByReplacingOccurrencesOfString:@"=" withString:@""];
    }
    return s;
}
static NSData* b64_decode(NSString* s, BOOL urlsafe) {
    if (urlsafe) {
        s = [s stringByReplacingOccurrencesOfString:@"-" withString:@"+"];
        s = [s stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
        while (s.length % 4) s = [s stringByAppendingString:@"="];
    }
    return [[NSData alloc] initWithBase64EncodedString:s options:0];
}

static int cr_b64encode(lua_State* S) {
    size_t n; const char* b = L.L_checklstring(S, 1, &n);
    NSString* s = b64_encode([NSData dataWithBytes:b length:n], NO);
    L.pushstring(S, s.UTF8String);
    return 1;
}
static int cr_b64decode(lua_State* S) {
    const char* s = L.L_checklstring(S, 1, NULL);
    NSData* d = b64_decode([NSString stringWithUTF8String:s], NO);
    L.pushlstring(S, (const char*)d.bytes, d.length);
    return 1;
}

static int cr_hash(lua_State* S) {
    size_t n; const char* buf = L.L_checklstring(S, 1, &n);
    const char* algo = L.type(S,2)==LUA_TSTRING ? L.tolstring(S,2,NULL) : "sha256";
    uint8_t out[64]; size_t outlen = 0;
    if (!strcasecmp(algo, "md5"))       { CC_MD5(buf, (CC_LONG)n, out); outlen = 16; }
    else if (!strcasecmp(algo, "sha1")) { CC_SHA1(buf, (CC_LONG)n, out); outlen = 20; }
    else if (!strcasecmp(algo, "sha256")){CC_SHA256(buf,(CC_LONG)n, out); outlen = 32; }
    else if (!strcasecmp(algo, "sha384")){CC_SHA384(buf,(CC_LONG)n, out); outlen = 48; }
    else if (!strcasecmp(algo, "sha512")){CC_SHA512(buf,(CC_LONG)n, out); outlen = 64; }
    else { L.pushnil(S); return 1; }
    char hex[129];
    for (size_t i = 0; i < outlen; i++) sprintf(hex + i*2, "%02x", out[i]);
    hex[outlen*2] = 0;
    L.pushstring(S, hex);
    return 1;
}

static int cr_generatebytes(lua_State* S) {
    int n = (int)L.tonumberx(S, 1, NULL);
    if (n <= 0 || n > 4096) { L.pushnil(S); return 1; }
    uint8_t buf[4096];
    CCRandomGenerateBytes(buf, n);
    NSString* out = b64_encode([NSData dataWithBytes:buf length:n], NO);
    L.pushstring(S, out.UTF8String);
    return 1;
}
static int cr_generatekey(lua_State* S) {
    uint8_t k[32]; CCRandomGenerateBytes(k, 32);
    NSString* out = b64_encode([NSData dataWithBytes:k length:32], NO);
    L.pushstring(S, out.UTF8String);
    return 1;
}

static int cr_encrypt(lua_State* S) {
    size_t plen, klen;
    const char* plain = L.L_checklstring(S, 1, &plen);
    const char* keyB64 = L.L_checklstring(S, 2, &klen);
    NSData* key = b64_decode([NSString stringWithUTF8String:keyB64], NO);
    if (key.length != 32) { L.pushnil(S); return 1; }
    uint8_t iv[16]; CCRandomGenerateBytes(iv, 16);
    size_t outlen = plen + 16;
    uint8_t* out = (uint8_t*)malloc(outlen);
    size_t done = 0;
    CCCryptorStatus st = CCCrypt(kCCEncrypt, kCCAlgorithmAES, kCCOptionPKCS7Padding,
        key.bytes, 32, iv, plain, plen, out, outlen, &done);
    if (st != kCCSuccess) { free(out); L.pushnil(S); return 1; }
    NSMutableData* comb = [NSMutableData dataWithBytes:iv length:16];
    [comb appendBytes:out length:done];
    free(out);
    L.pushstring(S, b64_encode(comb, NO).UTF8String);
    return 1;
}
static int cr_decrypt(lua_State* S) {
    const char* cB64 = L.L_checklstring(S, 1, NULL);
    const char* kB64 = L.L_checklstring(S, 2, NULL);
    NSData* comb = b64_decode([NSString stringWithUTF8String:cB64], NO);
    NSData* key  = b64_decode([NSString stringWithUTF8String:kB64], NO);
    if (comb.length < 16 || key.length != 32) { L.pushnil(S); return 1; }
    const uint8_t* iv = (const uint8_t*)comb.bytes;
    const uint8_t* ct = iv + 16;
    size_t ctlen = comb.length - 16;
    uint8_t* out = (uint8_t*)malloc(ctlen);
    size_t done = 0;
    CCCryptorStatus st = CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionPKCS7Padding,
        key.bytes, 32, iv, ct, ctlen, out, ctlen, &done);
    if (st != kCCSuccess) { free(out); L.pushnil(S); return 1; }
    L.pushlstring(S, (const char*)out, done);
    free(out);
    return 1;
}

extern "C" void crypt_lib_install(lua_State* S) {
    L.createtable(S, 0, 8);
    struct { const char* n; lua_CFunction f; } r[] = {
        {"base64encode",  cr_b64encode},
        {"base64_encode", cr_b64encode},
        {"base64decode",  cr_b64decode},
        {"base64_decode", cr_b64decode},
        {"hash",          cr_hash},
        {"generatebytes", cr_generatebytes},
        {"generatekey",   cr_generatekey},
        {"encrypt",       cr_encrypt},
        {"decrypt",       cr_decrypt},
        {NULL, NULL}
    };
    for (int i = 0; r[i].n; i++) {
        L.pushcclosurek(S, r[i].f, r[i].n, 0, NULL);
        L.setfield(S, -2, r[i].n);
    }
    lua_setglobal(S, "crypt");
}
