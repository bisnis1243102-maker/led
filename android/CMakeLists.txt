cmake_minimum_required(VERSION 3.22)
project(RobloxMod CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Luau compiler sources — cloned into third_party/luau by the workflow.
set(LUAU third_party/luau)
file(GLOB LUAU_SRC
    ${LUAU}/Compiler/src/*.cpp
    ${LUAU}/Ast/src/*.cpp)

add_library(luau_compiler STATIC ${LUAU_SRC})
target_include_directories(luau_compiler PUBLIC
    ${LUAU}/Compiler/include
    ${LUAU}/Ast/include
    ${LUAU}/Common/include)
target_compile_options(luau_compiler PRIVATE -O2 -fno-rtti)

add_library(RobloxMod SHARED
    jni/entry.cpp
    jni/native_shim.cpp
    jni/hooks_android.cpp
    jni/executor_lib.cpp
    jni/scheduler.cpp
    jni/roblox_globals.cpp
    jni/debug_lib.cpp
    jni/crypt_lib.cpp
    jni/autoexec.cpp
    jni/luau_compile_bridge.cpp)

target_include_directories(RobloxMod PRIVATE jni ${LUAU}/Compiler/include ${LUAU}/Ast/include ${LUAU}/Common/include)
target_link_libraries(RobloxMod PRIVATE luau_compiler log android dl)
target_compile_options(RobloxMod PRIVATE -O2 -fvisibility=hidden -Wno-unused-parameter)
