// The native log redaction (src/native/log_redact.h), the same cases as
// packages/electron/src/log-redact.test.ts. Run: pnpm --filter @sbtltv/mpv-texture test:redact
#include "../src/native/log_redact.h"
#include <cassert>
#include <iostream>
#include <chrono>
int main() {
    auto check = [](const std::string& in, const std::string& want) {
        std::string got = redactUrls(in);
        if (got != want) { std::cerr << "FAIL\n in:   " << in << "\n got:  " << got << "\n want: " << want << "\n"; return false; }
        return true;
    };
    bool ok = true;
    ok &= check("Opening http://provider.example:8080/live/user/s3cret/1.ts\n", "Opening http://provider.example:8080/\xE2\x80\xA6\n");
    ok &= check("Failed to open http://user:p@ss@host.example/x", "Failed to open http://\xE2\x80\xA6");
    ok &= check("a http://a.example/1 b https://b.example/2?x=1", "a http://a.example/\xE2\x80\xA6 b https://b.example/\xE2\x80\xA6");
    ok &= check("x1http://provider.example/live/u/p/1.ts", "x1http://provider.example/\xE2\x80\xA6");
    ok &= check("[http://provider.example/live/u/p/1.ts]", "[http://provider.example/\xE2\x80\xA6");
    ok &= check("://provider.example/live/u/p/1.ts", "://provider.example/\xE2\x80\xA6");
    ok &= check("host only http://host.example done", "host only http://host.example done");
    ok &= check("quote 'http://h.example/u/pa\"s/1.ts' end", "quote 'http://h.example/\xE2\x80\xA6 end");
    ok &= check("", "");
    ok &= check("GET player_api.php?username=bob&password=s3cret&action=x", "GET player_api.php?username=\xE2\x80\xA6&password=\xE2\x80\xA6&action=x");
    ok &= check("Opening 'live/bob/s3cret/12345.ts'", "Opening 'live/\xE2\x80\xA6/12345.ts'");
    ok &= check("Location: /movie/bob/s3cret/99.mkv", "Location: /movie/\xE2\x80\xA6/99.mkv");
    ok &= check("token=abc123 and api_key=xyz", "token=\xE2\x80\xA6 and api_key=\xE2\x80\xA6");
    ok &= check("a monkey=banana", "a monkey=banana");
    { std::string big(200000, 'a'); auto t0 = std::chrono::steady_clock::now(); ok &= check(big, big);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count(); std::cout << "200k line: " << ms << "ms\n"; ok &= ms < 200; }
    std::cout << (ok ? "all passed\n" : "failures\n");
    return ok ? 0 : 1;
}
