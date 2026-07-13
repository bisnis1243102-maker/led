// crypt.* — pure-C SHA256 + base64 (no OpenSSL dependency). Sufficient for
// executor-community usage which is dominated by base64 + SHA256 (hash IDs,
// signed manifests, script obfuscation). AES omitted to keep dependency-free;
// scripts that need it call HTTP-side services.
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdio.h>
#include "luau_shim.h"

// -- base64 -----------------------------------------------------------------
static const char b64c[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static char* b64enc(const uint8_t* in, size_t n, size_t* outlen) {
    size_t o = ((n + 2) / 3) * 4;
    char* r = (char*)malloc(o + 1);
    size_t j = 0;
    for (size_t i = 0; i < n; i += 3) {
        uint32_t v = in[i] << 16;
        if (i+1 < n) v |= in[i+1] << 8;
        if (i+2 < n) v |= in[i+2];
        r[j++] = b64c[(v >> 18) & 63];
        r[j++] = b64c[(v >> 12) & 63];
        r[j++] = (i+1 < n) ? b64c[(v >> 6) & 63] : '=';
        r[j++] = (i+2 < n) ? b64c[v & 63]        : '=';
    }
    r[j] = 0; if (outlen) *outlen = j; return r;
}
static uint8_t* b64dec(const char* in, size_t* outlen) {
    size_t n = strlen(in);
    uint8_t* r = (uint8_t*)malloc(n);
    size_t j = 0; uint32_t v = 0; int bits = 0;
    for (size_t i = 0; i < n; i++) {
        char c = in[i];
        int d = -1;
        if (c >= 'A' && c <= 'Z') d = c - 'A';
        else if (c >= 'a' && c <= 'z') d = c - 'a' + 26;
        else if (c >= '0' && c <= '9') d = c - '0' + 52;
        else if (c == '+') d = 62;
        else if (c == '/') d = 63;
        else continue;
        v = (v << 6) | d;
        bits += 6;
        if (bits >= 8) { bits -= 8; r[j++] = (v >> bits) & 0xFF; }
    }
    if (outlen) *outlen = j;
    return r;
}

// -- SHA-256 ----------------------------------------------------------------
struct SHA256 { uint32_t h[8]; uint64_t bits; uint8_t buf[64]; size_t bl; };
static const uint32_t K[64] = {
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
#define ROR(x,n) (((x) >> (n)) | ((x) << (32-(n))))
static void sha_block(SHA256* s, const uint8_t* p) {
    uint32_t w[64];
    for (int i=0; i<16; i++)
        w[i] = (p[i*4]<<24)|(p[i*4+1]<<16)|(p[i*4+2]<<8)|p[i*4+3];
    for (int i=16; i<64; i++) {
        uint32_t s0 = ROR(w[i-15],7)^ROR(w[i-15],18)^(w[i-15]>>3);
        uint32_t s1 = ROR(w[i-2],17)^ROR(w[i-2],19)^(w[i-2]>>10);
        w[i] = w[i-16]+s0+w[i-7]+s1;
    }
    uint32_t a=s->h[0],b=s->h[1],c=s->h[2],d=s->h[3];
    uint32_t e=s->h[4],f=s->h[5],g=s->h[6],h=s->h[7];
    for (int i=0; i<64; i++) {
        uint32_t S1 = ROR(e,6)^ROR(e,11)^ROR(e,25);
        uint32_t ch = (e&f)^(~e&g);
        uint32_t t1 = h+S1+ch+K[i]+w[i];
        uint32_t S0 = ROR(a,2)^ROR(a,13)^ROR(a,22);
        uint32_t mj = (a&b)^(a&c)^(b&c);
        uint32_t t2 = S0+mj;
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    s->h[0]+=a; s->h[1]+=b; s->h[2]+=c; s->h[3]+=d;
    s->h[4]+=e; s->h[5]+=f; s->h[6]+=g; s->h[7]+=h;
}
static void sha_init(SHA256* s) {
    s->h[0]=0x6a09e667; s->h[1]=0xbb67ae85; s->h[2]=0x3c6ef372; s->h[3]=0xa54ff53a;
    s->h[4]=0x510e527f; s->h[5]=0x9b05688c; s->h[6]=0x1f83d9ab; s->h[7]=0x5be0cd19;
    s->bits = 0; s->bl = 0;
}
static void sha_update(SHA256* s, const uint8_t* d, size_t n) {
    s->bits += n * 8;
    while (n) {
        size_t r = 64 - s->bl;
        size_t c = n < r ? n : r;
        memcpy(s->buf + s->bl, d, c);
        s->bl += c; d += c; n -= c;
        if (s->bl == 64) { sha_block(s, s->buf); s->bl = 0; }
    }
}
static void sha_final(SHA256* s, uint8_t* out) {
    s->buf[s->bl++] = 0x80;
    if (s->bl > 56) { memset(s->buf+s->bl, 0, 64-s->bl); sha_block(s, s->buf); s->bl = 0; }
    memset(s->buf+s->bl, 0, 56-s->bl);
    for (int i=0; i<8; i++) s->buf[63-i] = (s->bits >> (i*8)) & 0xFF;
    sha_block(s, s->buf);
    for (int i=0; i<8; i++) {
        out[i*4]   = s->h[i] >> 24;
        out[i*4+1] = s->h[i] >> 16;
        out[i*4+2] = s->h[i] >> 8;
        out[i*4+3] = s->h[i];
    }
}

// -- Lua bindings -----------------------------------------------------------
static int cr_b64enc(lua_State* S) {
    size_t n; const char* b = L.L_checklstring(S, 1, &n);
    size_t o; char* r = b64enc((const uint8_t*)b, n, &o);
    L.pushlstring(S, r, o); free(r); return 1;
}
static int cr_b64dec(lua_State* S) {
    const char* in = L.L_checklstring(S, 1, NULL);
    size_t o; uint8_t* r = b64dec(in, &o);
    L.pushlstring(S, (const char*)r, o); free(r); return 1;
}
static int cr_sha256(lua_State* S) {
    size_t n; const char* b = L.L_checklstring(S, 1, &n);
    SHA256 s; sha_init(&s); sha_update(&s, (const uint8_t*)b, n);
    uint8_t out[32]; sha_final(&s, out);
    char hex[65];
    for (int i=0; i<32; i++) snprintf(hex+i*2, 3, "%02x", out[i]);
    L.pushstring(S, hex); return 1;
}

extern "C" void crypt_lib_install(lua_State* S) {
    L.createtable(S, 0, 4);
    L.pushcclosurek(S, cr_b64enc, "base64encode", 0, NULL);
    L.setfield(S, -2, "base64encode");
    L.pushcclosurek(S, cr_b64dec, "base64decode", 0, NULL);
    L.setfield(S, -2, "base64decode");
    L.pushcclosurek(S, cr_sha256, "hash", 0, NULL);
    L.setfield(S, -2, "hash");
    lua_setglobal(S, "crypt");
}
