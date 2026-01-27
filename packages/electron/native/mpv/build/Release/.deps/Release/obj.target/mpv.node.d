cmd_Release/obj.target/mpv.node := g++ -o Release/obj.target/mpv.node -shared -pthread -rdynamic -m64  -Wl,-soname=mpv.node -Wl,--start-group Release/obj.target/mpv/mpv.o -Wl,--end-group -lmpv
