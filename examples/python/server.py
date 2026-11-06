"""Runnable Python HTTP adapter backed by the existing independent Neon merchant store."""
import hmac
import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from settlekit_adapter import AdapterError, fetch_current_eligibility, origin, receipt_disposition, safe_request, verify_webhook

ALLOW_LOCAL = os.environ.get("ALLOW_LOCAL_HTTP") == "true"
PUBLIC_ORIGIN = origin(os.environ.get("STORE_ORIGIN", "http://127.0.0.1:3300"), ALLOW_LOCAL)
BACKEND = origin(os.environ.get("PYTHON_STORE_BACKEND_ORIGIN", "http://127.0.0.1:3200"), ALLOW_LOCAL)
GATEWAY = origin(os.environ.get("APP_ORIGIN", "http://127.0.0.1:3000"), ALLOW_LOCAL)
SERVER_KEY = os.environ.get("STORE_GATEWAY_API_KEY", "")
WEBHOOK_SECRET = os.environ.get("STORE_WEBHOOK_SECRET", "")
ORDER_SECRET = os.environ.get("STORE_ORDER_READ_KEY", "")
if any(len(secret) < 32 for secret in (SERVER_KEY, WEBHOOK_SECRET, ORDER_SECRET)):
    raise AdapterError("PRIVATE_CONFIGURATION_REQUIRED")
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
ORDER_PATH = re.compile(rf"^/api/orders/({UUID})(?:/(status|checkout|cancel|download))?$")


class Handler(BaseHTTPRequestHandler):
    server_version = "SettleKitMerchantAdapter"
    def log_message(self, *args):
        pass  # Credentials, request bodies and private order capabilities are never logged.

    def send(self, status, raw, content_type="application/json"):
        self.send_response(status)
        for key, value in {"Content-Type": content_type, "Content-Length": str(len(raw)), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}.items():
            self.send_header(key, value)
        self.end_headers(); self.wfile.write(raw)

    def body(self):
        if self.headers.get("Transfer-Encoding"):
            raise AdapterError("BODY_ENCODING_UNSUPPORTED", 400)
        length = self.headers.get("Content-Length", "0")
        if not length.isdigit() or int(length) > 32768:
            raise AdapterError("BODY_TOO_LARGE", 413)
        raw = self.rfile.read(int(length))
        if len(raw) != int(length):
            raise AdapterError("BODY_INCOMPLETE", 400)
        return raw

    def handle_request(self):
        try:
            self.connection.settimeout(10)
            if self.headers.get("Host") != urllib.parse.urlsplit(PUBLIC_ORIGIN).netloc:
                raise AdapterError("HOST_DENIED", 403)
            parsed = urllib.parse.urlsplit(self.path)
            path = parsed.path
            raw = self.body() if self.command == "POST" else None
            if self.command == "POST" and path == "/api/webhooks/settlekit":
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise AdapterError("CONTENT_TYPE_INVALID", 415)
                timestamp = self.headers.get("x-settlekit-timestamp", ""); signature = self.headers.get("x-settlekit-signature", "")
                verify_webhook(raw, timestamp, signature, WEBHOOK_SECRET)
                try:
                    event = json.loads(raw)
                except (UnicodeError, json.JSONDecodeError):
                    raise AdapterError("EVENT_INVALID", 400) from None
                if isinstance(event, dict) and event.get("event_type") == "endpoint.test":
                    if set(event) != {"event_id", "event_type", "created_at", "message"} or not isinstance(event.get("message"), str) or len(event["message"]) > 256:
                        raise AdapterError("TEST_EVENT_INVALID", 400)
                    self.send(200, b'{"test":true,"fulfillment":false}'); return
                current = fetch_current_eligibility(str(event.get("payment_id", "")), GATEWAY, SERVER_KEY, ALLOW_LOCAL)
                receipt_disposition(event, current)
                # Actual commit callback: the existing store rechecks current eligibility and
                # applies receipt/order/payment/entitlement in one separate Neon transaction.
                status, response, content_type = safe_request(BACKEND + path, BACKEND, allow_local=ALLOW_LOCAL, method="POST", headers={"Content-Type": "application/json", "x-settlekit-timestamp": timestamp, "x-settlekit-signature": signature}, raw=raw)
                self.send(status, response, content_type); return
            match = ORDER_PATH.fullmatch(path)
            public_get = self.command == "GET" and path in ("/", "/store.css", "/app.js", "/fonts/manrope.ttf")
            order_route = match and ((self.command == "GET" and match[2] in (None, "status", "download")) or (self.command == "POST" and match[2] in ("checkout", "cancel")))
            if not public_get and not order_route and not (self.command == "POST" and path == "/api/orders"):
                raise AdapterError("NOT_FOUND", 404)
            if self.command == "POST" and self.headers.get("Origin") != PUBLIC_ORIGIN:
                raise AdapterError("ORIGIN_DENIED", 403)
            if match and self.command == "GET" and match[2] is None and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + ORDER_SECRET):
                raise AdapterError("UNAUTHORIZED", 401)
            headers = {"Origin": PUBLIC_ORIGIN}
            if self.headers.get("Authorization"):
                headers["Authorization"] = self.headers["Authorization"]
            if self.command == "POST":
                headers["Content-Type"] = "application/json"
            # Fixed path allowlist + fixed configured backend. There is no arbitrary URL proxy.
            suffix = path + (("?" + parsed.query) if path == "/" and parsed.query else "")
            status, response, content_type = safe_request(BACKEND + suffix, BACKEND, allow_local=ALLOW_LOCAL, method=self.command, headers=headers, raw=raw, maximum=262144 if path == "/fonts/manrope.ttf" else 32768)
            self.send(status, response, content_type)
        except AdapterError as error:
            self.send(error.status, json.dumps({"error": {"code": error.code, "message": "This merchant action could not finish. Check the order state before retrying."}}).encode())
        except (OSError, ValueError, TypeError, AttributeError):
            self.send(503, b'{"error":{"code":"ADAPTER_UNAVAILABLE","message":"The merchant adapter is temporarily unavailable."}}')

    do_GET = handle_request
    do_POST = handle_request


if __name__ == "__main__":
    parsed = urllib.parse.urlsplit(PUBLIC_ORIGIN)
    # Local example only. Public hosting/reverse-proxy TLS requires its own deployment setup.
    if parsed.hostname not in ("127.0.0.1", "localhost") or parsed.scheme != "http" or not ALLOW_LOCAL:
        raise AdapterError("LOCAL_DEMO_CONFIGURATION_REQUIRED")
    server = ThreadingHTTPServer(("127.0.0.1", parsed.port or 3300), Handler)
    server.daemon_threads = True
    print("Python merchant adapter listening on " + PUBLIC_ORIGIN)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
