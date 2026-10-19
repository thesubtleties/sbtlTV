// The native log redaction must survive the process exiting while mpv's log
// thread is still redacting (app.exit(0) skips the player teardown): its
// shared host sets must outlive static destruction. A crash here exits non-zero.
#include "../src/native/log_redact.h"
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <string>
#include <thread>
int main() {
    for (int i = 0; i < 1000; i++) noteUrl("http://h" + std::to_string(i) + ".example/x");
    std::atomic<long> n{0};
    for (int t = 0; t < 2; t++) {
        std::thread([&n] {
            for (;;) { redactUrls("tcp: Failed to resolve hostname h1.example h2.example http://h3.example/x h999.example: x"); n++; }
        }).detach();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    std::exit(0);
}
