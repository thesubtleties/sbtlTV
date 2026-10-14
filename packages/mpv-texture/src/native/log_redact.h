#pragma once

#include <cctype>
#include <string>

// Logs are cleaned of provider login details before they reach stderr (a
// terminal or the system journal). The app's copy is
// packages/electron/src/log-redact.ts; keep the two in step:
// - every :// starts a URL, whatever is glued in front of it, and runs to the
//   next whitespace; it is cut to scheme://host/... (scheme://... when it holds an @);
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

inline std::string cutUrls(const std::string& text) {
    const auto isSchemeChar = [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '+' || c == '.' || c == '-';
    };
    std::string out;
    size_t pos = 0;
    while (pos < text.size()) {
        const size_t sep = text.find("://", pos);
        if (sep == std::string::npos) {
            out.append(text, pos, std::string::npos);
            break;
        }
        size_t start = sep;
        while (start > pos && isSchemeChar(text[start - 1])) start--;
        size_t end = sep + 3;
        while (end < text.size() && !std::isspace(static_cast<unsigned char>(text[end]))) end++;
        out.append(text, pos, start - pos);
        const std::string scheme = text.substr(start, sep + 3 - start);
        const std::string rest = text.substr(sep + 3, end - sep - 3);
        if (rest.find('@') != std::string::npos) {
            out += scheme + ellipsis();
        } else {
            const size_t hostEnd = rest.find_first_of("/?#");
            out += hostEnd == std::string::npos ? scheme + rest : scheme + rest.substr(0, hostEnd) + "/" + ellipsis();
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
