// The native log redaction (src/native/log_redact.h), the same cases as
// packages/electron/src/log-redact.test.ts, with the native [host] label. Run: pnpm --filter @sbtltv/mpv-texture test:redact
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
    ok &= check("Opening http://provider.example:8080/live/user/s3cret/1.ts\n", "Opening http://[host]/\xE2\x80\xA6\n");
    ok &= check("Failed to open http://user:p@ss@host.example/x", "Failed to open http://\xE2\x80\xA6");
    ok &= check("a http://a.example/1 b https://b.example/2?x=1", "a http://[host]/\xE2\x80\xA6 b https://[host]/\xE2\x80\xA6");
    ok &= check("x1http://provider.example/live/u/p/1.ts", "x1http://[host]/\xE2\x80\xA6");
    ok &= check("[http://provider.example/live/u/p/1.ts]", "[http://[host]/\xE2\x80\xA6");
    ok &= check("://provider.example/live/u/p/1.ts", "://[host]/\xE2\x80\xA6");
    ok &= check("host only http://host.example done", "host only http://[host] done");
    ok &= check("quote 'http://h.example/u/pa\"s/1.ts' end", "quote 'http://[host]/\xE2\x80\xA6 end");
    ok &= check("ipv6 http://[2001:db8::1]:8080/live/u/p/1.ts", "ipv6 http://[host]/\xE2\x80\xA6");
    ok &= check("empty x:// host", "empty x:// host");
    ok &= check("tmdb https://API.themoviedb.org/3/movie/1?api_key=k", "tmdb https://api.themoviedb.org/\xE2\x80\xA6");
    ok &= check("logo https://a.espncdn.com/i/x.png", "logo https://a.espncdn.com/\xE2\x80\xA6");
    ok &= check("Opening http://seen-host.example/live/u/p/1.ts", "Opening http://[host]/\xE2\x80\xA6");
    ok &= check("ffmpeg: tcp: Failed to resolve hostname seen-host.example: x", "ffmpeg: tcp: Failed to resolve hostname [host]: x");
    ok &= check("never-in-a-url.example and libavcodec.so.61 v0.13.0", "never-in-a-url.example and libavcodec.so.61 v0.13.0");
    ok &= check("Failed to open http://[host]/\xE2\x80\xA6", "Failed to open http://[host]/\xE2\x80\xA6");
    { const std::string once = redactUrls("a http://seen-host.example/x then seen-host.example"); ok &= check(once, once); }
    {
        const char* const bypasses[] = {
            "http://[host]/live/bob/s3cret/1.ts?password=s3cret",
            "http://[host]evil.example/live/bob/s3cret/1.ts",
            "http://[source:x]real.example/live/bob/s3cret/1.ts",
            "a http://[host 1 then http://real.example/live/bob/s3cret/1.ts ]",
        };
        for (const char* line : bypasses) {
            const std::string out = redactUrls(line);
            const bool leaked = out.find("s3cret") != std::string::npos || out.find("bob") != std::string::npos
                || out.find("real.example") != std::string::npos || out.find("evil.example") != std::string::npos;
            if (leaked) { std::cerr << "FAIL bypass\n in:  " << line << "\n got: " << out << "\n"; ok = false; }
        }
    }
    ok &= check("ok [source 1] and [host 2] stay", "ok [source 1] and [host 2] stay");
    ok &= check("at file:///home/steven/secret/file.ts:10", "at file:///\xE2\x80\xA6");
    ok &= check("http://:8080/home/steven/a.ts", "http:///\xE2\x80\xA6");
    { const std::string out = redactUrls("{\"url\":\"http://qq.tv\",\"x\":1} later qq.tv");
      if (out.find("qq.tv") != std::string::npos) { std::cerr << "FAIL json glued\n got: " << out << "\n"; ok = false; } }
    { const std::string out = redactUrls("ENOTFOUND cdn.zzz.tv (http://cdn.zzz.tv/live/a/b/1.ts)");
      if (out.find("cdn.zzz.tv") != std::string::npos) { std::cerr << "FAIL bare before url\n got: " << out << "\n"; ok = false; } }
    noteUrl("http://user:pw@quiet-load.example:8080/live/a/b/1.ts");
    ok &= check("[ffmpeg] tcp: Failed to resolve hostname quiet-load.example: x", "[ffmpeg] tcp: Failed to resolve hostname [host]: x");
    { std::string big; for (int i = 0; i < 100000; i++) big += "a://";
      auto t0 = std::chrono::steady_clock::now(); redactUrls(big);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
      std::cout << "100k :// line: " << ms << "ms\n"; ok &= ms < 200; }
    {
        const char* const more[] = {
            "http://[source: x http://bob:s3cret@real.example/live/u/p/1.ts y]",
            "http://[source 1x]real.example/live/bob/s3cret/1.ts",
        };
        for (const char* line : more) {
            const std::string out = redactUrls(line);
            if (out.find("s3cret") != std::string::npos || out.find("bob") != std::string::npos || out.find("real.example") != std::string::npos) {
                std::cerr << "FAIL bypass\n in:  " << line << "\n got: " << out << "\n"; ok = false;
            }
        }
    }
    log_redact_detail::resetSeenHostsForTest();
    ok &= check("[ffmpeg] tcp: Failed to resolve hostname edge3.cdn.example: x", "[ffmpeg] tcp: Failed to resolve hostname [host]: x");
    ok &= check("getaddrinfo EAI_AGAIN unseen.example", "getaddrinfo EAI_AGAIN [host]");
    ok &= check("connect ECONNREFUSED 203.0.113.5:8080", "connect ECONNREFUSED [host]:8080");
    ok &= check("peer 198.51.100.7 closed, local 127.0.0.1 fine", "peer [host] closed, local 127.0.0.1 fine");
    ok &= check("getaddrinfo ENOTFOUND api.themoviedb.org", "getaddrinfo ENOTFOUND api.themoviedb.org");
    ok &= check("Opening http://provider-x.example/a", "Opening http://[host]/\xE2\x80\xA6");
    ok &= check("edge2.provider-x.example and PROVIDER-X.example", "[host] and [host]");
    ok &= check("files https://files.tmdb.org/p/x.gz", "files https://files.tmdb.org/\xE2\x80\xA6");
    // The cap must not stop a host on the same line, or one being loaded, from being labelled.
    log_redact_detail::resetSeenHostsForTest();
    for (int i = 0; i < 1100; i++) redactUrls("http://filler" + std::to_string(i) + ".example/x");
    ok &= check("Opening http://late.example/x then late.example", "Opening http://[host]/\xE2\x80\xA6 then [host]");
    noteUrl("http://loaded-after-cap.example/live/a/b/1.ts");
    ok &= check("Failed to open loaded-after-cap.example", "Failed to open [host]");
    { const std::string big = std::string(300, 'a') + ".example"; ok &= check("http://" + big + "/x", "http://[host]/\xE2\x80\xA6"); }
    log_redact_detail::resetSeenHostsForTest();
    ok &= check("", "");
    ok &= check("GET player_api.php?username=bob&password=s3cret&action=x", "GET player_api.php?username=\xE2\x80\xA6&password=\xE2\x80\xA6&action=x");
    ok &= check("Opening 'live/bob/s3cret/12345.ts'", "Opening 'live/\xE2\x80\xA6/12345.ts'");
    ok &= check("Location: /movie/bob/s3cret/99.mkv", "Location: /movie/\xE2\x80\xA6/99.mkv");
    ok &= check("token=abc123 and api_key=xyz", "token=\xE2\x80\xA6 and api_key=\xE2\x80\xA6");
    ok &= check("a monkey=banana", "a monkey=banana");
    { std::string big(200000, 'a'); auto t0 = std::chrono::steady_clock::now(); ok &= check(big, big);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count(); std::cout << "200k line: " << ms << "ms\n"; ok &= ms < 200; }
    // More login names (same list as log-redact.ts)
    ok &= check("pwd=hunter2&x=1 access_token=abc refresh_token=d id_token=e auth_token=f", "pwd=\xE2\x80\xA6&x=1 access_token=\xE2\x80\xA6 refresh_token=\xE2\x80\xA6 id_token=\xE2\x80\xA6 auth_token=\xE2\x80\xA6");
    ok &= check("client_secret=s secret=t auth=u", "client_secret=\xE2\x80\xA6 secret=\xE2\x80\xA6 auth=\xE2\x80\xA6");
    ok &= check("monkey=1 bypass=2", "monkey=1 bypass=2");
    // Bare IPv6 (not loopback; times and single colons are not addresses)
    ok &= check("connect to 2001:db8:85a3::8a2e:370:7334 failed", "connect to [host] failed");
    ok &= check("peer fe80::1%eth0 and 2a00:1450:4001:82a::200e", "peer [host]%eth0 and [host]");
    ok &= check("at 12:34:56 and 00:00:01.500", "at 12:34:56 and 00:00:01.500");
    ok &= check("loopback ::1 stays", "loopback ::1 stays");
    ok &= check("surface::bar std::face::b", "surface::bar std::face::b");
    { std::string big; for (int i = 0; i < 100000; i++) big += "a:"; auto t0 = std::chrono::steady_clock::now(); redactUrls(big);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count(); std::cout << "200k colons: " << ms << "ms\n"; ok &= ms < 200; }
    { std::string big(200000, ':'); auto t0 = std::chrono::steady_clock::now(); redactUrls(big);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count(); std::cout << "200k '::': " << ms << "ms\n"; ok &= ms < 200; }
    // IPv6 edges (same as log-redact.test.ts): only whole, well-formed addresses
    for (const char* s : {"surface::bead and cafe::bead_x", "ratio 1::2::3", "x :1::2", "deadbeef::1", "1:2:3:4:5:6:7:8::9"}) ok &= check(s, s);
    ok &= check("ipv6 http://[2001:db8::1]:8080/x and 2001:db8::1", "ipv6 http://[host]/\xE2\x80\xA6 and [host]");
    std::cout << (ok ? "all passed\n" : "failures\n");
    return ok ? 0 : 1;
}
