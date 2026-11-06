"""Standard-library protocol/transport adapter; secrets remain on the merchant server."""
from __future__ import annotations

import hashlib
import hmac
import http.client
import ipaddress
import json
import queue
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

CHAIN_ID = 1874
TOKEN = "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7"
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
AMOUNT = re.compile(r"^(0|[1-9][0-9]{0,77})$")


class AdapterError(Exception):
    def __init__(self, code: str, status: int = 503):
        super().__init__(code)
        self.code, self.status = code, status


def origin(value: str, allow_local: bool = False) -> str:
    parsed = urllib.parse.urlsplit(value)
    local = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/") or not parsed.hostname:
        raise AdapterError("ORIGIN_CONFIGURATION")
    if parsed.scheme != "https" and not (allow_local and local and parsed.scheme == "http"):
        raise AdapterError("ORIGIN_CONFIGURATION")
    return f"{parsed.scheme}://{parsed.netloc}"


def _addresses(host: str, port: int, allow_local: bool, timeout: float) -> str:
    # A daemon resolver cannot keep a timed-out request alive indefinitely.
    result: queue.Queue = queue.Queue(maxsize=1)
    def resolve():
        try:
            result.put(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except OSError:
            result.put(None)
    threading.Thread(target=resolve, daemon=True).start()
    try:
        answers = result.get(timeout=timeout)
    except queue.Empty:
        raise AdapterError("DEPENDENCY_TIMEOUT") from None
    if not answers or len(answers) > 32:
        raise AdapterError("DEPENDENCY_UNAVAILABLE")
    addresses = [ipaddress.ip_address(answer[4][0]) for answer in answers]
    local_name = host in ("127.0.0.1", "localhost", "::1")
    if any(not (allow_local and local_name and address.is_loopback) and not address.is_global for address in addresses):
        raise AdapterError("ENDPOINT_NOT_ALLOWED")
    if local_name and any(not address.is_loopback for address in addresses):
        raise AdapterError("ENDPOINT_NOT_ALLOWED")
    return str(addresses[0])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def safe_request(url: str, approved_origin: str, *, allow_local: bool = False,
                 method: str = "GET", headers: dict | None = None, raw: bytes | None = None,
                 timeout: float = 8.0, maximum: int = 32768) -> tuple[int, bytes, str]:
    approved_origin = origin(approved_origin, allow_local)
    parsed = urllib.parse.urlsplit(url)
    if f"{parsed.scheme}://{parsed.netloc}" != approved_origin or parsed.username or parsed.password or parsed.fragment:
        raise AdapterError("ENDPOINT_NOT_ALLOWED")
    if method not in ("GET", "POST") or timeout <= 0 or timeout > 15 or maximum > 262144:
        raise AdapterError("REQUEST_CONFIGURATION")
    deadline = time.monotonic() + timeout
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    pinned = _addresses(parsed.hostname, port, allow_local, timeout)
    context = ssl.create_default_context()

    class PinnedHTTP(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.create_connection((pinned, self.port), timeout=max(.05, deadline - time.monotonic()))

    class PinnedHTTPS(http.client.HTTPSConnection):
        def connect(self):
            connection = socket.create_connection((pinned, self.port), timeout=max(.05, deadline - time.monotonic()))
            self.sock = context.wrap_socket(connection, server_hostname=parsed.hostname)

    class HTTPHandler(urllib.request.HTTPHandler):
        def http_open(self, request):
            return self.do_open(PinnedHTTP, request)

    class HTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self, request):
            return self.do_open(PinnedHTTPS, request)

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect(), HTTPHandler(), HTTPSHandler())
    request = urllib.request.Request(url, data=raw, headers=headers or {}, method=method)
    try:
        with opener.open(request, timeout=max(.05, deadline - time.monotonic())) as response:
            if response.status != 200 and response.status != 201:
                raise AdapterError("DEPENDENCY_HTTP_ERROR")
            parts, length = [], 0
            while True:
                if time.monotonic() >= deadline:
                    raise AdapterError("DEPENDENCY_TIMEOUT")
                if response.fp and response.fp.raw:
                    response.fp.raw._sock.settimeout(max(.05, deadline - time.monotonic()))
                chunk = response.read(min(8192, maximum + 1 - length))
                if not chunk:
                    break
                parts.append(chunk)
                length += len(chunk)
                if length > maximum:
                    raise AdapterError("DEPENDENCY_TOO_LARGE")
            return response.status, b"".join(parts), response.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise AdapterError("DEPENDENCY_REDIRECT_DENIED") from None
        raise AdapterError("DEPENDENCY_HTTP_ERROR", error.code if error.code in (400, 401, 403, 404, 409, 429) else 503) from None
    except (OSError, urllib.error.URLError, TimeoutError):
        raise AdapterError("DEPENDENCY_UNAVAILABLE") from None


def verify_webhook(raw: bytes, timestamp: str, signature: str, secret: str, now: float | None = None):
    now = time.time() if now is None else now
    if len(secret) < 32:
        raise AdapterError("WEBHOOK_CONFIGURATION")
    if len(raw) > 32768 or not re.fullmatch(r"[0-9]{10}", timestamp or "") or abs(now - int(timestamp)) > 300:
        raise AdapterError("WEBHOOK_TIMESTAMP_OR_BODY_INVALID", 400)
    if not re.fullmatch(r"v1=[a-f0-9]{64}", signature or ""):
        raise AdapterError("WEBHOOK_SIGNATURE_INVALID", 401)
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature[3:], expected):
        raise AdapterError("WEBHOOK_SIGNATURE_INVALID", 401)


def _amount(value) -> int:
    if not isinstance(value, str) or not AMOUNT.fullmatch(value) or int(value) >= 2**256:
        raise AdapterError("AMOUNT_INVALID", 400)
    return int(value)


def _time(value) -> float:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.timestamp()
    except (AttributeError, TypeError, ValueError):
        raise AdapterError("TIME_INVALID", 400) from None


def association(value):
    if not isinstance(value, dict) or any(not isinstance(value.get(key), str) or not IDENTIFIER.fullmatch(value[key]) for key in ("payment_id", "checkout_reference", "merchant_order_id")):
        raise AdapterError("ASSOCIATION_INVALID", 400)
    if value.get("chain_id") != CHAIN_ID or str(value.get("token", "")).lower() != TOKEN or any(not ADDRESS.fullmatch(str(value.get(key, ""))) for key in ("payer", "merchant")):
        raise AdapterError("ASSOCIATION_INVALID", 400)
    if type(value.get("state_version")) is not int or value["state_version"] < 1 or type(value.get("eligible")) is not bool or value.get("confirmation_stage") != "included_2_blocks":
        raise AdapterError("ASSOCIATION_INVALID", 400)
    if _amount(value.get("amount_base_units")) == 0 or _amount(value.get("refund_amount_base_units")) > _amount(value["amount_base_units"]):
        raise AdapterError("ASSOCIATION_INVALID", 400)


def receipt_disposition(event: dict, current: dict, now: float | None = None) -> str:
    now = time.time() if now is None else now
    association(event); association(current)
    if event.get("event_type") not in ("payment.accepted", "payment.review") or not IDENTIFIER.fullmatch(str(event.get("event_id", ""))):
        raise AdapterError("EVENT_INVALID", 400)
    _time(event.get("created_at"))
    for key in ("payment_id", "checkout_reference", "merchant_order_id", "amount_base_units", "chain_id"):
        if event[key] != current[key]:
            raise AdapterError("ASSOCIATION_MISMATCH", 409)
    for key in ("token", "payer", "merchant"):
        if event[key].lower() != current[key].lower():
            raise AdapterError("ASSOCIATION_MISMATCH", 409)
    expires = _time(current.get("grant_expires_at"))
    if not now < expires <= now + 15 or type(current.get("refund_hold")) is not bool or current.get("status") not in ("accepted", "orphaned", "review", "pending"):
        raise AdapterError("ELIGIBILITY_INVALID")
    if event["state_version"] != current["state_version"]:
        return "superseded"
    if event["event_type"] != "payment.accepted" or current["status"] != "accepted" or not event["eligible"] or not current["eligible"] or current["refund_hold"] or _amount(current["refund_amount_base_units"]) or _amount(event["refund_amount_base_units"]):
        return "review"
    return "fulfill"


def fetch_current_eligibility(payment_id: str, gateway_origin: str, server_key: str, allow_local: bool = False) -> dict:
    if not IDENTIFIER.fullmatch(payment_id) or len(server_key) < 32:
        raise AdapterError("PAYMENT_CONFIGURATION")
    _, raw, _ = safe_request(f"{origin(gateway_origin, allow_local)}/api/v1/payments/{payment_id}/eligibility", gateway_origin, allow_local=allow_local, headers={"Authorization": "Bearer " + server_key})
    try:
        value = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError):
        raise AdapterError("ELIGIBILITY_INVALID") from None
    association(value)
    return value
