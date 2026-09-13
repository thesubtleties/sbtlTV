// Root of libmpv's deep-bound scope: keep its FFmpeg private while using
// the host allocator for memory exchanged with libc and other shared libraries.
#include <cstdlib>
#include <dlfcn.h>
#include <malloc.h>
#include <unistd.h>

namespace {
void* hostSymbol(const char* name) {
    // RTLD_DEFAULT would find these wrappers again. The executable handle
    // searches the host scope, outside this RTLD_LOCAL library.
    void* host = dlopen(nullptr, RTLD_NOW);
    void* symbol = host ? dlsym(host, name) : nullptr;
    if (host) dlclose(host);
    if (!symbol) {
        constexpr char error[] = "[mpv-texture] host allocator symbol unavailable\n";
        const auto written = write(STDERR_FILENO, error, sizeof(error) - 1);
        (void)written;
        _exit(127);
    }
    return symbol;
}
}

extern "C" {
void* malloc(size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::malloc)>(hostSymbol("malloc"));
    return function(size);
}
void free(void* pointer) noexcept {
    static auto function = reinterpret_cast<decltype(&::free)>(hostSymbol("free"));
    function(pointer);
}
void* calloc(size_t count, size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::calloc)>(hostSymbol("calloc"));
    return function(count, size);
}
void* realloc(void* pointer, size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::realloc)>(hostSymbol("realloc"));
    return function(pointer, size);
}
void* aligned_alloc(size_t alignment, size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::aligned_alloc)>(hostSymbol("aligned_alloc"));
    return function(alignment, size);
}
int posix_memalign(void** pointer, size_t alignment, size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::posix_memalign)>(hostSymbol("posix_memalign"));
    return function(pointer, alignment, size);
}
void* memalign(size_t alignment, size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::memalign)>(hostSymbol("memalign"));
    return function(alignment, size);
}
void* valloc(size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::valloc)>(hostSymbol("valloc"));
    return function(size);
}
void* pvalloc(size_t size) noexcept {
    static auto function = reinterpret_cast<decltype(&::pvalloc)>(hostSymbol("pvalloc"));
    return function(size);
}
size_t malloc_usable_size(void* pointer) noexcept {
    static auto function = reinterpret_cast<decltype(&::malloc_usable_size)>(hostSymbol("malloc_usable_size"));
    return function(pointer);
}
}
