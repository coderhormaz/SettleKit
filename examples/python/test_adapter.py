"""Real local HTTP boundary tests; chain/order responses below are explicit fixtures."""
import hashlib
import hmac
import http.client
import json
import threading
import time
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from settlekit_adapter import AdapterError, _addresses, association, origin, receipt_disposition, safe_request, verify_webhook

SECRET = "python-test-only-signing-secret-000000000"
NOW = 1794000000


def signed(raw, stamp):
    return "v1=" + hmac.new(SECRET.encode(), str(stamp).encode() + b"." + raw, hashlib.sha256).hexdigest()


def current():
    return {"payment_id": "payment_fixture", "checkout_reference": "checkout_fixture", "merchant_order_id": "order_fixture", "amount_base_units": "25000000", "refund_amount_base_units": "0", "chain_id": 1874, "token": "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7", "payer": "0x" + "1" * 40, "merchant": "0x" + "2" * 40, "state_version": 1, "eligible": True, "confirmation_stage": "included_2_blocks", "status": "accepted", "refund_hold": False, "grant_expires_at": datetime.fromtimestamp(NOW + 10, timezone.utc).isoformat()}


class Transport(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302); self.send_header("Location", "/body"); self.end_headers()
        else:
            self.send_response(200); self.end_headers(); self.wfile.write(b"x" * 100)


class AdapterTests(unittest.TestCase):
    def assert_code(self, expected, operation):
        with self.assertRaises(AdapterError) as caught:
            operation()
        self.assertEqual(caught.exception.code, expected)

    def test_hmac_authenticates_exact_bytes_and_timestamp(self):
        raw = b'{"fixture":true}'
        verify_webhook(raw, str(NOW), signed(raw, NOW), SECRET, NOW)
        self.assert_code("WEBHOOK_SIGNATURE_INVALID", lambda: verify_webhook(raw + b" ", str(NOW), signed(raw, NOW), SECRET, NOW))
        self.assert_code("WEBHOOK_TIMESTAMP_OR_BODY_INVALID", lambda: verify_webhook(raw, str(NOW - 301), signed(raw, NOW - 301), SECRET, NOW))

    def test_monetary_and_chain_types_are_strict(self):
        for field, value in [("amount_base_units", "25.0"), ("amount_base_units", str(2**256)), ("amount_base_units", 25000000), ("refund_amount_base_units", "25000001"), ("chain_id", 1874.0), ("state_version", True)]:
            with self.subTest(field=field, value=value):
                candidate = current(); candidate[field] = value
                with self.assertRaises(AdapterError):
                    association(candidate)

    def test_current_refund_and_version_win_over_old_event(self):
        event = current(); event.update(event_id="event_fixture", event_type="payment.accepted", created_at=datetime.fromtimestamp(NOW, timezone.utc).isoformat())
        self.assertEqual(receipt_disposition(event, current(), NOW), "fulfill")
        held = current(); held["refund_hold"] = True
        self.assertEqual(receipt_disposition(event, held, NOW), "review")
        newer = current(); newer["state_version"] = 2
        self.assertEqual(receipt_disposition(event, newer, NOW), "superseded")
        changed = current(); changed["payer"] = "0x" + "3" * 40
        self.assert_code("ASSOCIATION_MISMATCH", lambda: receipt_disposition(event, changed, NOW))

    def test_expired_and_overlong_grants_never_fulfill(self):
        event = current(); event.update(event_id="event_fixture", event_type="payment.accepted", created_at=datetime.fromtimestamp(NOW, timezone.utc).isoformat())
        for expires in (NOW - 1, NOW + 16):
            changed = current(); changed["grant_expires_at"] = datetime.fromtimestamp(expires, timezone.utc).isoformat()
            self.assert_code("ELIGIBILITY_INVALID", lambda: receipt_disposition(event, changed, NOW))

    def test_approved_origin_and_private_dns_are_enforced(self):
        self.assert_code("ORIGIN_CONFIGURATION", lambda: origin("https://user:secret@example.test"))
        self.assert_code("ENDPOINT_NOT_ALLOWED", lambda: safe_request("https://other.test/", "https://merchant.test"))
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("10.0.0.1", 443))]):
            self.assert_code("ENDPOINT_NOT_ALLOWED", lambda: _addresses("merchant.test", 443, False, 1))

    def test_real_http_redirect_and_response_limits(self):
        backend = ThreadingHTTPServer(("127.0.0.1", 0), Transport); thread = threading.Thread(target=backend.serve_forever, daemon=True); thread.start()
        base = "http://127.0.0.1:" + str(backend.server_port)
        try:
            self.assert_code("DEPENDENCY_REDIRECT_DENIED", lambda: safe_request(base + "/redirect", base, allow_local=True))
            self.assert_code("DEPENDENCY_TOO_LARGE", lambda: safe_request(base + "/body", base, allow_local=True, maximum=10))
        finally:
            backend.shutdown(); backend.server_close(); thread.join()

    def test_real_callback_rejects_signed_nonobject_before_dependency(self):
        with patch.dict("os.environ", {"ALLOW_LOCAL_HTTP": "true", "STORE_ORIGIN": "http://127.0.0.1:3300", "STORE_GATEWAY_API_KEY": SECRET, "STORE_WEBHOOK_SECRET": SECRET, "STORE_ORDER_READ_KEY": SECRET}):
            import server
        backend = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler); previous = server.PUBLIC_ORIGIN; server.PUBLIC_ORIGIN = "http://127.0.0.1:" + str(backend.server_port)
        thread = threading.Thread(target=backend.serve_forever, daemon=True); thread.start()
        try:
            with patch.object(server, "fetch_current_eligibility") as dependency:
                for raw, valid, expected in [(b"[]", True, 400), (b"{}", False, 401), (json.dumps({"event_id": "event_fixture", "event_type": "endpoint.test", "created_at": "2026-11-06T00:00:00Z", "message": "Test only"}).encode(), True, 200)]:
                    connection = http.client.HTTPConnection("127.0.0.1", backend.server_port, timeout=2); stamp = str(int(time.time()))
                    connection.request("POST", "/api/webhooks/settlekit", raw, {"Content-Type": "application/json", "x-settlekit-timestamp": stamp, "x-settlekit-signature": signed(raw, stamp) if valid else "v1=" + "0" * 64})
                    response = connection.getresponse(); self.assertEqual(response.status, expected); response.read(); connection.close()
                dependency.assert_not_called()
        finally:
            backend.shutdown(); backend.server_close(); thread.join(); server.PUBLIC_ORIGIN = previous


if __name__ == "__main__":
    unittest.main()
