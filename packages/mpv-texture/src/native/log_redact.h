#pragma once

#include <cctype>
#include <string>

// Stream URLs carry provider credentials (Xtream puts the username and password
// in the path). mpv's log lines go to stderr (a terminal or the system journal),
// so every URL in them is cut to scheme://host/..., as the app's debug log does
// (packages/electron/src/log-redact.ts). Every :// starts a URL, whatever is
// glued in front of it; a URL runs to the next whitespace, and one holding an @
// anywhere (credentials before the host) keeps only its scheme.
inline std::string redactUrls(const std::string& text) {
    static const char* const kEllipsis = "\xE2\x80\xA6";
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
            out += scheme + kEllipsis;
        } else {
            const size_t hostEnd = rest.find_first_of("/?#");
            out += hostEnd == std::string::npos ? scheme + rest : scheme + rest.substr(0, hostEnd) + "/" + kEllipsis;
        }
        pos = end;
    }
    return out;
}
