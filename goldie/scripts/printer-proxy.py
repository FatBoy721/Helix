#!/usr/bin/env python3
"""Bridge the Android emulator to a printer on the LAN.

The emulator has no route to the LAN (`nc: connect: No route to host`), so
Helix cannot reach the printer directly. This runs on the host, which can, and
`adb reverse` maps the emulator's loopback onto it:

    /usr/bin/python3 goldie/scripts/printer-proxy.py &
    adb root                       # needed to bind :80 inside the emulator
    adb reverse tcp:7125 tcp:7125  # Moonraker
    adb reverse tcp:8081 tcp:8081  # printer web root
    adb reverse tcp:80   tcp:8081  # what the app's relative camera path hits

RUN IT WITH /usr/bin/python3. macOS Local Network Privacy blocks Homebrew
`node` (and Homebrew python) from the LAN with EHOSTUNREACH, while
Apple-signed binaries are allowed. This is not the Claude sandbox; disabling
that does not help.

Port 7125 is a dumb TCP pipe. Port 8081 is HTTP-aware for exactly one path:

    /webcam/webrtc  ->  a local page that polls /webcam/snapshot.jpg

Why: the printer advertises WebRTC, which needs UDP, and an `adb reverse`
tunnel only carries TCP — the camera card renders a dead player reading
"Connection lost". Helix has a snapshot path that works over plain HTTP, but
pointing the app at it means typing a URL into the add-printer dialog, and
that field is the one that broke capture: a mistimed keystroke concatenated
two URLs, Helix passed "…:7125http://…" to okhttp, and the app hard-crashed
with `IllegalArgumentException: Invalid URL port`. Serving the working
content at the URL the app already defaults to removes that whole class of
failure — the capture flow never touches the camera field.
"""
import socket
import threading

TARGET = "192.168.1.17"
TCP_MAP = [(7125, 7125)]        # (local, remote) — straight pipe
HTTP_PORT = 8081                # HTTP-aware, proxies to TARGET:80

# Polls the printer's own snapshot endpoint. Sized to the card, object-fit
# cover so it fills without letterboxing, and cache-busted per frame.
WEBRTC_SHIM = b"""<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  img{width:100%;height:100%;object-fit:cover;display:block}
</style>
<img id="v">
<script>
  var v = document.getElementById('v');
  function tick(){ v.src = '/webcam/snapshot.jpg?t=' + Date.now(); }
  v.onload = function(){ setTimeout(tick, 200); };
  v.onerror = function(){ setTimeout(tick, 1000); };
  tick();
</script>
"""


def pump(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                s.close()
            except Exception:
                pass


def pipe(client, remote):
    """Blind TCP relay — used for Moonraker, which is a websocket."""
    try:
        up = socket.create_connection((TARGET, remote), timeout=10)
        up.settimeout(None)
        client.settimeout(None)
        threading.Thread(target=pump, args=(client, up), daemon=True).start()
        threading.Thread(target=pump, args=(up, client), daemon=True).start()
    except Exception as e:
        print(f"up:{remote} err {e}", flush=True)
        client.close()


def http(client):
    """Peek at the request line; shim /webcam/webrtc, relay everything else."""
    try:
        client.settimeout(10)
        head = b""
        while b"\r\n" not in head and len(head) < 8192:
            chunk = client.recv(4096)
            if not chunk:
                client.close()
                return
            head += chunk

        line = head.split(b"\r\n", 1)[0]
        path = line.split(b" ")[1] if len(line.split(b" ")) > 1 else b"/"
        import time as _t
        print(f"REQLOG {_t.strftime('%H:%M:%S')} {line.decode('latin1')[:90]}", flush=True)

        if path.startswith(b"/webcam/webrtc"):
            client.sendall(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: text/html; charset=utf-8\r\n"
                b"Cache-Control: no-store\r\n"
                b"Connection: close\r\n"
                b"Content-Length: " + str(len(WEBRTC_SHIM)).encode() + b"\r\n"
                b"\r\n" + WEBRTC_SHIM
            )
            client.close()
            return

        # Everything else is the printer's own web root, replayed verbatim
        # including the bytes already read off the socket.
        up = socket.create_connection((TARGET, 80), timeout=10)
        up.sendall(head)
        up.settimeout(None)
        client.settimeout(None)
        threading.Thread(target=pump, args=(client, up), daemon=True).start()
        threading.Thread(target=pump, args=(up, client), daemon=True).start()
    except Exception as e:
        print(f"http err {e}", flush=True)
        try:
            client.close()
        except Exception:
            pass


def serve(local, handler):
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", local))
    srv.listen(64)
    print(f"listening 127.0.0.1:{local}", flush=True)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handler, args=(c,), daemon=True).start()


for lo, re_ in TCP_MAP:
    threading.Thread(
        target=serve, args=(lo, lambda c, r=re_: pipe(c, r)), daemon=True
    ).start()
threading.Thread(target=serve, args=(HTTP_PORT, http), daemon=True).start()
print(f"proxy -> {TARGET}  (7125 tcp, {HTTP_PORT} http + /webcam/webrtc shim)", flush=True)
threading.Event().wait()
