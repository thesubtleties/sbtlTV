#pragma once

#include <algorithm>
#include <cctype>
#include <mutex>
#include <string>
#include <unordered_set>

// Logs are cleaned of provider login details before they reach stderr (a
// terminal or the system journal). The app's copy is
// packages/electron/src/log-redact.ts; keep the two in step:
// - every :// starts a URL, whatever is glued in front of it, and runs to the
//   next whitespace; it is cut to scheme://[host]/... (scheme://... when it holds
//   an @). Public services stay readable (kPublicHosts, the same list as
//   PUBLIC_HOSTS in log-redact.ts). The app's copy uses source names and
//   numbered labels; this one has no source names, so it writes [host];
// - a host seen in a URL is also replaced where it appears bare later on;
// - text that is already redacted passes through unchanged;
// - login values outside a URL ("username=bob") become "username=...";
// - Xtream paths ("live/bob/s3cret/1.ts") become "live/.../1.ts".
// Plain loops, one pass each: no backtracking on long lines.

namespace log_redact_detail {

inline const char* ellipsis() { return "\xE2\x80\xA6"; }

inline bool isWordChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
}

inline bool endsValue(char c) {
    return c == '&' || c == '\'' || c == '"' || std::isspace(static_cast<unsigned char>(c));
}

inline std::string lower(const std::string& text) {
    std::string out(text);
    for (char& c : out) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return out;
}

inline bool isPublicHost(const std::string& host) {
    static const char* const kPublicHosts[] = {
        "api.themoviedb.org", "image.tmdb.org", "api.ratingposterdb.com", "github.com",
        "objects.githubusercontent.com", "raw.githubusercontent.com", "a.espncdn.com", "am.i.mullvad.net"};
    for (const char* h : kPublicHosts) if (host == h) return true;
    return false;
}

// Hosts seen in URLs this process (mpv logs from its own threads, hence the
// mutex): a later bare mention ("Failed to resolve hostname <host>") is
// labelled too. Capped so a flood of odd URLs cannot grow it without bound.
inline std::mutex& seenHostsMutex() { static std::mutex m; return m; }
inline std::unordered_set<std::string>& seenHosts() { static std::unordered_set<std::string> s; return s; }
inline void noteHost(const std::string& host) {
    std::lock_guard<std::mutex> lock(seenHostsMutex());
    if (seenHosts().size() < 1024) seenHosts().insert(host);
}
inline bool isSeenHost(const std::string& host) {
    std::lock_guard<std::mutex> lock(seenHostsMutex());
    return seenHosts().count(host) != 0;
}

// Length of a label written by redaction at text[i] ("[host]", or the app's
// "[host 3]", "[source: <name>]"), or 0. Only those exact shapes count, so text
// that merely starts like one ("[host]evil.example/...") is redacted like
// anything else. Lets text redacted twice stay the same.
inline size_t labelLengthAt(const std::string& text, size_t i) {
    if (text.compare(i, 6, "[host]") == 0) return 6;
    if (text.compare(i, 6, "[host ") == 0) {
        size_t j = i + 6;
        while (j < text.size() && std::isdigit(static_cast<unsigned char>(text[j]))) j++;
        return j > i + 6 && j < text.size() && text[j] == ']' ? j + 1 - i : 0;
    }
    if (text.compare(i, 9, "[source: ") == 0) {
        const size_t limit = std::min(text.size(), i + 9 + 100);
        for (size_t j = i + 9; j < limit; j++) {
            if (text[j] == ']') return j + 1 - i;
            if (text[j] == '[' || text[j] == '\n') return 0;
        }
    }
    return 0;
}

inline bool isHostChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '.';
}

// The host of "host:port" or "[v6]:port", lowercased, without port or brackets.
inline std::string hostOf(const std::string& hostPort) {
    if (!hostPort.empty() && hostPort[0] == '[') {
        const size_t close = hostPort.find(']');
        return lower(close == std::string::npos ? hostPort.substr(1) : hostPort.substr(1, close - 1));
    }
    const size_t colon = hostPort.find(':');
    return lower(colon == std::string::npos ? hostPort : hostPort.substr(0, colon));
}

// Seen hostnames outside URLs become [host]. One pass: each character is looked at once.
inline std::string cutBareHosts(const std::string& text) {
    if (text.find('.') == std::string::npos) return text;
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
        const std::string token = text.substr(a, b - a);
        if (token.find('.') != std::string::npos && isSeenHost(lower(token))) {
            out.append(text, pos, a - pos);
            out += "[host]";
            pos = b;
        }
        i = end;
    }
    out.append(text, pos, std::string::npos);
    return out;
}

inline std::string cutUrls(const std::string& text) {
    const auto isSchemeChar = [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '+' || c == '.' || c == '-';
    };
    std::string out;
    size_t pos = 0;
    while (pos < text.size()) {
        const size_t sep = text.find("://", pos);
        if (sep == std::string::npos) {
            out += cutBareHosts(text.substr(pos));
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
            if (after == text.size() || std::isspace(static_cast<unsigned char>(text[after]))) {
                out += cutBareHosts(text.substr(pos, start - pos));
                out.append(text, start, after - start);
                pos = after;
                continue;
            }
        }
        size_t end = sep + 3;
        while (end < text.size() && !std::isspace(static_cast<unsigned char>(text[end]))) end++;
        out += cutBareHosts(text.substr(pos, start - pos));
        const std::string scheme = text.substr(start, sep + 3 - start);
        const std::string rest = text.substr(sep + 3, end - sep - 3);
        if (rest.find('@') != std::string::npos) {
            out += scheme + ellipsis();
        } else {
            const size_t hostEnd = rest.find_first_of("/?#");
            const std::string hostPort = hostEnd == std::string::npos ? rest : rest.substr(0, hostEnd);
            const std::string host = hostOf(hostPort);
            if (host.empty()) {
                out += scheme + rest;
            } else {
                const bool isPublic = isPublicHost(host);
                if (!isPublic) noteHost(host);
                const std::string label = isPublic ? host : "[host]";
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
        return c != '/' && c != '\'' && c != '"' && !std::isspace(static_cast<unsigned char>(c));
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

inline std::string redactUrls(const std::string& text) {
    using namespace log_redact_detail;
    return cutXtreamPaths(cutLoginParams(cutUrls(text)));
}
