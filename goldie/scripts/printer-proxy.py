import socket, threading
TARGET = '192.168.1.17'
MAP = [(7125, 7125), (8081, 80)]   # (local_port, printer_port)

def pump(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data: break
            b.sendall(data)
    except Exception: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except Exception: pass
            try: s.close()
            except Exception: pass

def handle(client, remote):
    try:
        up = socket.create_connection((TARGET, remote), timeout=10)
        up.settimeout(None); client.settimeout(None)
        threading.Thread(target=pump, args=(client, up), daemon=True).start()
        threading.Thread(target=pump, args=(up, client), daemon=True).start()
    except Exception as e:
        print(f'up:{remote} err {e}', flush=True)
        client.close()

def serve(local, remote):
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', local)); srv.listen(64)
    print(f'proxy 127.0.0.1:{local} -> {TARGET}:{remote}', flush=True)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c, remote), daemon=True).start()

for l, r in MAP:
    threading.Thread(target=serve, args=(l, r), daemon=True).start()
threading.Event().wait()
