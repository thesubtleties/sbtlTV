#!/bin/bash
# Test mpv IPC behavior - mimics what the Electron app does

SOCKET_PATH="/tmp/mpv-test-socket-$$"
TEST_STREAM="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"

echo "=== MPV IPC Test ==="
echo "Socket: $SOCKET_PATH"
echo "Stream: $TEST_STREAM"
echo ""

# Clean up on exit
cleanup() {
    echo ""
    echo "Cleaning up..."
    [ -S "$SOCKET_PATH" ] && rm -f "$SOCKET_PATH"
    jobs -p | xargs -r kill 2>/dev/null
}
trap cleanup EXIT

# Start mpv with same args as our app (Wayland/separate window mode)
echo "Starting mpv..."
mpv \
    --idle=yes \
    --input-ipc-server="$SOCKET_PATH" \
    --keep-open=yes \
    --force-window=yes \
    --vo=gpu \
    --hwdec=auto \
    --terminal=yes \
    --msg-level=all=v \
    &

MPV_PID=$!
echo "mpv PID: $MPV_PID"

# Wait for socket
echo "Waiting for socket..."
for i in {1..10}; do
    [ -S "$SOCKET_PATH" ] && break
    sleep 0.5
done

if [ ! -S "$SOCKET_PATH" ]; then
    echo "ERROR: Socket not created after 5 seconds"
    exit 1
fi
echo "Socket ready!"
echo ""

# Helper to send IPC command
send_cmd() {
    echo "$1" | socat - "$SOCKET_PATH"
}

# Load the stream
echo "=== Loading stream ==="
send_cmd '{"command": ["loadfile", "'"$TEST_STREAM"'"]}'
sleep 2

# Check if paused
echo ""
echo "=== Checking pause state ==="
send_cmd '{"command": ["get_property", "pause"]}'

# Try to unpause
echo ""
echo "=== Sending unpause ==="
send_cmd '{"command": ["set_property", "pause", false]}'
sleep 1

# Check state again
echo ""
echo "=== Final state check ==="
send_cmd '{"command": ["get_property", "pause"]}'
send_cmd '{"command": ["get_property", "time-pos"]}'

echo ""
echo "=== mpv should be playing now ==="
echo "Watch the mpv window. Press Ctrl+C to exit."
echo ""

# Keep running so we can observe
wait $MPV_PID
