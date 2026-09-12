# 模拟 Panabit Portal 认证服务器 (GB2312 响应), 用于真机端到端联调
# 用法: python mock_panabit.py [port]  默认 8080
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8080
TEST_USER = "test"
TEST_PASS_MD5_AES = None  # 收到什么记什么, 只比对明文
LOG = []

VALID = {"test": "123456"}
AUTH = {"ok": False}


def gb(s):
    return s.encode("gb2312", "replace")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
        action = q.get("action", "")
        route = q.get("route", "")
        LOG.append((action, dict(q)))
        with open("mock_server.log", "a", encoding="utf-8") as f:
            f.write("REQ %s %s\n" % (self.path, "OK"))

        if action == "load_portal_conf":
            body = (
                '{"msg":"成功","code":0,"data":{"policy":{"auth1":"panabit","policy_logic":1,'
                '"scene_str":"","after_success":1},"style":{"pageConfig":{"phone":{"title":"测试网络认证"}}}}}'
            )
        elif action == "user_login":
            uname = q.get("username", "")
            # password 是 AES-128-ECB/ZeroPadding hex, 本地无法解密, 只验证非空 + 用户名匹配
            ok = q.get("password", "") and VALID.get(uname)
            remember = q.get("remember_me", "0")
            print("LOGIN user=%s pass_hex=%s remember=%s ip=%r mac=%r code=%r auth_type=%r"
                  % (uname, q.get("password", ""), remember, q.get("ip"), q.get("mac"),
                     q.get("code"), q.get("auth_type")), flush=True)
            if ok:
                AUTH["ok"] = True
                body = '{"msg":"成功","code":0,"data":null}'
            else:
                body = '{"msg":"认证失败:INV_NAMEORPWD","code":255,"data":null}'
        elif action == "query_auth_stat":
            body = '{"msg":"成功","code":0,"data":{"stat":%d}}' % (1 if AUTH["ok"] else 0)
        elif action == "load_user_list":
            # 在线设备列表 (管理页 getApplication 提取的字段)
            devices = []
            if AUTH["ok"]:
                devices = [
                    {"uid": 1, "name": "当前设备", "ipstr": "192.168.50.11",
                     "clntmac": "aa:cc:09:c5:19:be", "birth": "00:12:33"},
                    {"uid": 2, "name": "同学的手机", "ipstr": "192.168.50.23",
                     "clntmac": "b8:27:eb:11:22:33", "birth": "01:05:02"},
                ]
            body = '{"msg":"成功","code":0,"data":%s}' % json.dumps(devices)
        elif action == "user_offone":
            addr = q.get("addr", "")
            print("OFFONE addr=%s" % addr, flush=True)
            if AUTH["ok"]:
                body = '{"msg":"成功","code":0,"data":null}'
            else:
                body = '{"msg":"无该在线用户","code":1,"data":null}'
        elif action == "user_offall":
            AUTH["ok"] = False
            body = '{"msg":"成功","code":0,"data":null}'
        elif action == "sms_send_code":
            body = '{"msg":"成功","code":0,"data":{"left":60}}'
        else:
            body = '{"msg":"unknown action","code":1,"data":null}'

        data = gb(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=GB2312")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    print("mock panabit portal on 0.0.0.0:%d (test/test123456 -> ok)" % PORT, flush=True)
    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever, daemon=True).start()
    try:
        while True:
            import time

            time.sleep(1)
    except KeyboardInterrupt:
        pass
