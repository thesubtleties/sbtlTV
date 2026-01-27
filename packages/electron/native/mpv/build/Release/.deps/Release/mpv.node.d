cmd_Release/mpv.node := ln -f "Release/obj.target/mpv.node" "Release/mpv.node" 2>/dev/null || (rm -rf "Release/mpv.node" && cp -af "Release/obj.target/mpv.node" "Release/mpv.node")
