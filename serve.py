#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse


class ShorthandHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="Serve Shorthand on localhost.")
    parser.add_argument("--port", type=int, default=4174, help="Port to serve on")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), ShorthandHandler)
    print(f"Shorthand running at http://127.0.0.1:{args.port}")
    try:
      server.serve_forever()
    except KeyboardInterrupt:
      print("\nShutting down.")
    finally:
      server.server_close()


if __name__ == "__main__":
    main()
