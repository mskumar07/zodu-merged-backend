"""pip install fastapi httpx pytest && pytest test_internal_auth.py (no model needed)."""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from internal_auth import caller_tokens, require_internal

EMPLOYEE = "e" * 64
AUTH = "a" * 64

app = FastAPI()
tokens = caller_tokens({"INTERNAL_TOKEN_EMPLOYEE": EMPLOYEE, "INTERNAL_TOKEN_AUTH": AUTH})


@app.post("/embedding", dependencies=[Depends(require_internal("employee", tokens=tokens))])
def embedding():
    return {"success": True}


client = TestClient(app)


def test_no_token_is_401():
    assert client.post("/embedding").status_code == 401


def test_unknown_token_is_401():
    assert client.post("/embedding", headers={"X-Internal-Token": "x" * 64}).status_code == 401


def test_other_service_token_is_403():
    assert client.post("/embedding", headers={"X-Internal-Token": AUTH}).status_code == 403


def test_employee_token_passes():
    assert client.post("/embedding", headers={"X-Internal-Token": EMPLOYEE}).status_code == 200


def test_short_tokens_are_ignored():
    assert caller_tokens({"INTERNAL_TOKEN_EMPLOYEE": "short", "OTHER": EMPLOYEE}) == {}
