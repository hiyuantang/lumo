# SPDX-License-Identifier: AGPL-3.0-only
import select
import socket
import socketserver
import sys

class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with socket.create_connection((sys.argv[1], 8080), timeout=10) as upstream:
                upstream.settimeout(60)
                self.request.settimeout(60)
                peers = {upstream: self.request, self.request: upstream}
                while True:
                    ready, _, _ = select.select(list(peers), [], [], 60)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        peers[source].sendall(data)
        except (OSError, TimeoutError):
            return

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with Server(('0.0.0.0', 8080), Relay) as server:
    server.serve_forever()
