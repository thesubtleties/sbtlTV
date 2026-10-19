#pragma once

#include <algorithm>
#include <cctype>
#include <mutex>
#include <string>
#include <unordered_set>

// Logs are cleaned of provider login details and addresses before they reach
// stderr (a terminal or the system journal). The app's copy is
// packages/electron/src/log-redact.ts; keep the two in step:
// - every :// starts a URL, whatever is glued in front of it, and runs to the
//   next ASCII whitespace; it is cut to scheme://[host]/... (scheme://... when
//   it holds an @; scheme:///... when it has no host). Public services stay
//   readable (kPublicHosts, the same list as PUBLIC_HOSTS in log-redact.ts). The
//   app's copy numbers its labels ([source N], [host N]); this one writes [host];
// - a bare hostname becomes [host] when it was seen in a URL (this line or
//   before), was loaded (noteUrl), is a subdomain of one of those, is an IPv4
//   address (not loopback), or follows "resolve hostname", ENOTFOUND, ECONNREFUSED...;
// - only the exact label shapes pass through, so text redacted twice stays the same;
// - login values outside a URL ("username=bob") become "username=...";
// - Xtream paths ("live/bob/s3cret/1.ts") become "live/.../1.ts".
// Plain loops, a few linear passes: no backtracking on long lines.

namespace log_redact_detail {

inline const char* ellipsis() { return "\xE2\x80\xA6"; }

// ASCII only (as the app's copy), whatever the C locale says.
inline bool isAsciiSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'; }
inline bool isAsciiDigit(char c) { return c >= '0' && c <= '9'; }
inline bool isAsciiAlpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
inline bool isAsciiAlnum(char c) { return isAsciiDigit(c) || isAsciiAlpha(c); }

inline bool isWordChar(char c) {
    return isAsciiAlnum(c) || c == '_';
}

inline bool endsValue(char c) {
    return c == '&' || c == '\'' || c == '"' || isAsciiSpace(c);
}

inline std::string lower(const std::string& text) {
    std::string out(text);
    for (char& c : out) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    return out;
}

inline bool isPublicHost(const std::string& host) {
    static const char* const kPublicHosts[] = {
        "api.themoviedb.org", "image.tmdb.org", "files.tmdb.org", "api.ratingposterdb.com", "github.com",
        "objects.githubusercontent.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com",
        "a.espncdn.com", "am.i.mullvad.net"};
    for (const char* h : kPublicHosts) if (host == h) return true;
    return false;
}

// Hosts the player knows: seen in URLs in log lines (capped), and the URLs it
// was asked to load (noteUrl; a separate, larger allowance, so a flood of odd
// URLs cannot stop the host being played from being labelled). mpv logs from
// its own threads, hence the mutex. Allocated once and never destroyed: the
// process can exit while mpv's log thread is still redacting (app.exit(0)
// skips the player teardown), and a destroyed set would crash it.
struct KnownHosts {
    std::mutex mutex;
    std::unordered_set<std::string> seen;
    std::unordered_set<std::string> loaded;
};
inline KnownHosts& knownHosts() {
    static KnownHosts* hosts = new KnownHosts();
    return *hosts;
}
constexpr size_t kMaxSeenHosts = 1024;
constexpr size_t kMaxLoadedHosts = 16384;
constexpr size_t kMaxHostLength = 253;  // DNS: anything longer is labelled but never stored

inline void noteHost(const std::string& host, bool loaded = false) {
    if (host.size() > kMaxHostLength || host.find('.') == std::string::npos) return;
    KnownHosts& known = knownHosts();
    std::lock_guard<std::mutex> lock(known.mutex);
    std::unordered_set<std::string>& set = loaded ? known.loaded : known.seen;
    if (set.size() < (loaded ? kMaxLoadedHosts : kMaxSeenHosts)) set.insert(host);
}

inline void resetSeenHostsForTest() {
    KnownHosts& known = knownHosts();
    std::lock_guard<std::mutex> lock(known.mutex);
    known.seen.clear();
    known.loaded.clear();
}

// The token is a known host, or a subdomain of one (edge2.provider.tv when
// provider.tv is known), on this line or before.
inline bool isKnownHost(const std::string& token, const std::unordered_set<std::string>& lineHosts) {
    if (token.size() > kMaxHostLength) return false;  // also bounds the suffix walk
    KnownHosts& known = knownHosts();
    std::lock_guard<std::mutex> lock(known.mutex);
    for (size_t at = 0;;) {
        const std::string suffix = token.substr(at);
        if (lineHosts.count(suffix) || known.seen.count(suffix) || known.loaded.count(suffix)) return true;
        const size_t dot = token.find('.', at);
        if (dot == std::string::npos) return false;
        at = dot + 1;
    }
}

// Length of "<prefix><digits>]" at text[i], or 0.
inline size_t numberedLabelAt(const std::string& text, size_t i, const char* prefix) {
    const size_t len = std::char_traits<char>::length(prefix);
    if (text.compare(i, len, prefix) != 0) return 0;
    size_t j = i + len;
    while (j < text.size() && isAsciiDigit(text[j])) j++;
    return j > i + len && j < text.size() && text[j] == ']' ? j + 1 - i : 0;
}

// Length of a label written by redaction at text[i] ("[host]", or the app's
// "[host 3]", "[source 2]"), or 0. Only those exact shapes count, so text that
// merely starts like one ("[host]evil.example/...") is redacted like anything
// else. Lets text redacted twice stay the same.
inline size_t labelLengthAt(const std::string& text, size_t i) {
    if (text.compare(i, 6, "[host]") == 0) return 6;
    const size_t host = numberedLabelAt(text, i, "[host ");
    return host ? host : numberedLabelAt(text, i, "[source ");
}

inline bool isHostChar(char c) {
    return isAsciiAlnum(c) || c == '-' || c == '.';
}

// The word just before text[a] (skipping a few spaces) says the next token is a
// host (ffmpeg's "resolve hostname", getaddrinfo, Node's net errors). Bounded look-back.
inline bool afterHostContext(const std::string& text, size_t a) {
    static const char* const kWords[] = {"hostname", "enotfound", "eai_again", "eai_noname", "econnrefused",
                                         "econnreset", "etimedout", "ehostunreach", "enetunreach"};
    size_t j = a;
    while (j > 0 && a - j < 4 && text[j - 1] == ' ') j--;
    size_t w = j;
    while (w > 0 && j - w < 16 && (isAsciiAlpha(text[w - 1]) || text[w - 1] == '_')) w--;
    if (w == j) return false;
    const std::string word = lower(text.substr(w, j - w));
    for (const char* k : kWords) if (word == k) return true;
    return false;
}

// A dotted IPv4 address other than loopback.
inline bool isIpv4(const std::string& token) {
    int parts = 0;
    size_t i = 0;
    while (i <= token.size()) {
        size_t j = i;
        int value = 0;
        while (j < token.size() && isAsciiDigit(token[j]) && j - i < 3) value = value * 10 + (token[j++] - '0');
        if (j == i || value > 255) return false;
        parts++;
        if (j == token.size()) break;
        if (token[j] != '.') return false;
        i = j + 1;
    }
    return parts == 4 && token.compare(0, 4, "127.") != 0;
}

// The host of "host:port" or "[v6]:port", lowercased, without port or brackets.
inline std::string hostOf(const std::string& hostPort) {
    if (!hostPort.empty() && hostPort[0] == '[') {
        const size_t close = hostPort.find(']');
        return lower(close == std::string::npos ? hostPort.substr(1) : hostPort.substr(1, close - 1));
    }
    // The host is the leading run of hostname characters: a port, or text glued on, is not part of it.
    size_t end = 0;
    while (end < hostPort.size() && isHostChar(hostPort[end])) end++;
    return lower(hostPort.substr(0, end));
}

// The host a URL's text after "://" names (after any user:pass@), or "" when there is none.
inline std::string urlHostOf(const std::string& rest) {
    const size_t authorityEnd = rest.find_first_of("/?#");
    const std::string authority = authorityEnd == std::string::npos ? rest : rest.substr(0, authorityEnd);
    const size_t at = authority.rfind('@');
    return hostOf(at == std::string::npos ? authority : authority.substr(at + 1));
}

// Hostnames outside URLs become [host] when known, or when the text says they
// are a host. Linear: each character is looked at once (look-backs are bounded).
inline std::string cutBareHosts(const std::string& text, const std::unordered_set<std::string>& lineHosts) {
    std::string out;
    size_t pos = 0;
    size_t i = 0;
    while (i < text.size()) {
        const size_t label = labelLengthAt(text, i);
        if (label > 0) { i += label; continue; }
        if (!isHostChar(text[i])) { i++; continue; }
        size_t end = i;
        while (end < text.size() && isHostChar(text[end])) end++;
        size_t a = i;
        size_t b = end;
        while (a < b && (text[a] == '.' || text[a] == '-')) a++;
        while (b > a && (text[b - 1] == '.' || text[b - 1] == '-')) b--;
        if (a < b) {
            const std::string token = lower(text.substr(a, b - a));
            const bool certain = afterHostContext(text, a) || isIpv4(token);
            if ((certain || token.find('.') != std::string::npos) && !isPublicHost(token)
                && (certain || isKnownHost(token, lineHosts))) {
                out.append(text, pos, a - pos);
                out += "[host]";
                pos = b;
            }
        }
        i = end;
    }
    out.append(text, pos, std::string::npos);
    return out;
}

inline std::string cutUrls(const std::string& text) {
    const auto isSchemeChar = [](char c) {
        return isAsciiAlnum(c) || c == '+' || c == '.' || c == '-';
    };
    // Every URL host on the line is made known first, so a bare mention before its URL is labelled too
    // (on this line even when the shared set is full). A URL runs to the next whitespace, as in the loop
    // below; the next search starts there (linear time).
    std::unordered_set<std::string> lineHosts;
    for (size_t at = text.find("://"); at != std::string::npos;) {
        size_t end = at + 3;
        while (end < text.size() && !isAsciiSpace(text[end])) end++;
        if (labelLengthAt(text, at + 3) == 0) {
            const std::string host = urlHostOf(text.substr(at + 3, end - at - 3));
            if (!host.empty() && !isPublicHost(host) && host.size() <= kMaxHostLength) {
                lineHosts.insert(host);
                noteHost(host);
            }
        }
        at = text.find("://", end);
    }
    std::string out;
    size_t pos = 0;
    while (pos < text.size()) {
        const size_t sep = text.find("://", pos);
        if (sep == std::string::npos) {
            out += cutBareHosts(text.substr(pos), lineHosts);
            break;
        }
        size_t start = sep;
        while (start > pos && isSchemeChar(text[start - 1])) start--;
        // Already redacted ("scheme://<label>" or "scheme://<label>/..." and nothing more): keep it as it is.
        const size_t label = labelLengthAt(text, sep + 3);
        if (label > 0) {
            size_t after = sep + 3 + label;
            const std::string slashEllipsis = std::string("/") + ellipsis();
            if (text.compare(after, slashEllipsis.size(), slashEllipsis) == 0) after += slashEllipsis.size();
            if (after == text.size() || isAsciiSpace(text[after])) {
                out += cutBareHosts(text.substr(pos, start - pos), lineHosts);
                out.append(text, start, after - start);
                pos = after;
                continue;
            }
        }
        size_t end = sep + 3;
        while (end < text.size() && !isAsciiSpace(text[end])) end++;
        out += cutBareHosts(text.substr(pos, start - pos), lineHosts);
        const std::string scheme = text.substr(start, sep + 3 - start);
        const std::string rest = text.substr(sep + 3, end - sep - 3);
        if (rest.find('@') != std::string::npos) {
            out += scheme + ellipsis();
        } else {
            const size_t hostEnd = rest.find_first_of("/?#");
            const std::string hostPort = hostEnd == std::string::npos ? rest : rest.substr(0, hostEnd);
            const std::string host = hostOf(hostPort);
            if (host.empty()) {
                out += rest.empty() ? scheme : scheme + "/" + ellipsis();  // no host (file:///home/...): the path still goes
            } else {
                const std::string label = isPublicHost(host) ? host : "[host]";
                out += hostEnd == std::string::npos ? scheme + label : scheme + label + "/" + ellipsis();
            }
        }
        pos = end;
    }
    return out;
}

inline std::string cutLoginParams(const std::string& text) {
    static const char* const kNames[] = {"username", "user", "password", "pass", "passwd", "token", "api_key", "apikey", "key"};
    const std::string low = lower(text);
    std::string out;
    size_t pos = 0;
    size_t i = 0;
    while (i < text.size()) {
        bool cut = false;
        if (i == 0 || !isWordChar(text[i - 1])) {
            for (const char* name : kNames) {
                const size_t len = std::char_traits<char>::length(name);
                if (low.compare(i, len, name) == 0 && i + len < text.size() && text[i + len] == '=') {
                    size_t end = i + len + 1;
                    while (end < text.size() && !endsValue(text[end])) end++;
                    if (end > i + len + 1) {
                        out.append(text, pos, i + len + 1 - pos);
                        out += ellipsis();
                        pos = end;
                        i = end;
                        cut = true;
                    }
                    break;
                }
            }
        }
        if (!cut) i++;
    }
    out.append(text, pos, std::string::npos);
    return out;
}

inline std::string cutXtreamPaths(const std::string& text) {
    static const char* const kKinds[] = {"live/", "movie/", "series/", "timeshift/"};
    const std::string low = lower(text);
    const auto isSegmentChar = [](char c) {
        return c != '/' && c != '\'' && c != '"' && !isAsciiSpace(c);
    };
    std::string out;
    size_t pos = 0;
    size_t i = 0;
    while (i < text.size()) {
        bool cut = false;
        if (i == 0 || !isWordChar(text[i - 1])) {
            for (const char* kind : kKinds) {
                const size_t len = std::char_traits<char>::length(kind);
                if (low.compare(i, len, kind) != 0) continue;
                size_t a = i + len;
                while (a < text.size() && isSegmentChar(text[a])) a++;
                if (a == i + len || a >= text.size() || text[a] != '/') break;
                size_t b = a + 1;
                while (b < text.size() && isSegmentChar(text[b])) b++;
                if (b == a + 1 || b >= text.size() || text[b] != '/') break;
                out.append(text, pos, i + len - pos);
                out += ellipsis();
                out += '/';
                pos = b + 1;
                i = b + 1;
                cut = true;
                break;
            }
        }
        if (!cut) i++;
    }
    out.append(text, pos, std::string::npos);
    return out;
}

}  // namespace log_redact_detail

// A URL the player is about to open: its host is known from now on, so mpv or
// ffmpeg naming it bare ("Failed to resolve hostname ...") is labelled even when
// no log line carried the URL first (debug logging off: warn level only).
inline void noteUrl(const std::string& url) {
    using namespace log_redact_detail;
    const size_t sep = url.find("://");
    if (sep == std::string::npos) return;
    const std::string host = urlHostOf(url.substr(sep + 3));
    if (!host.empty() && !isPublicHost(host)) noteHost(host, true);
}

inline std::string redactUrls(const std::string& text) {
    using namespace log_redact_detail;
    return cutXtreamPaths(cutLoginParams(cutUrls(text)));
}
