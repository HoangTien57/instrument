"""Instrument - server local.

Chay:  python server.py   (hoac double-click chay.bat)
Mo:    http://localhost:8765

- Phuc vu giao dien trong thu muc web/
- Luu danh sach nhac trong thu muc songs/ (moi bai 1 file .json)
- Them bai: goi Claude Code (claude -p) bang goi subscription san co -> khong can API key
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
SONGS = os.path.join(ROOT, "songs")
PORT = 8765
NOTE_RE = re.compile(r"^[A-G][#b]?[0-8]$")
CHORD_RE = re.compile(r"^[A-G][#b]?[A-Za-z0-9#+()/]*$")


# ---------- tim claude.exe ----------
def find_claude():
    env = os.environ.get("INSTRUMENT_CLAUDE")
    if env and os.path.exists(env):
        return env
    home = os.path.expanduser("~")
    pats = [
        os.path.join(home, ".antigravity-ide", "extensions", "anthropic.claude-code-*", "resources", "native-binary", "claude.exe"),
        os.path.join(home, ".vscode", "extensions", "anthropic.claude-code-*", "resources", "native-binary", "claude.exe"),
        os.path.join(home, ".local", "bin", "claude.exe"),
    ]
    found = [p for pat in pats for p in glob.glob(pat)]
    if found:
        return max(found, key=os.path.getmtime)  # ban moi nhat
    return shutil.which("claude")


PROMPT = """Ban la nhac si phoi khi. Nguoi dung muon choi bai hat: ten <<{title}>>, nghe si <<{artist}>>.

Nhiem vu:
1) DUNG WebSearch + WebFetch de tim NGUON THAT cua bai, uu tien nguon dang chu (khong phai anh/PDF):
   - Hop am: trang hop am co hop am ghi tren loi (vd hopamchuan.com cho nhac Viet, ultimate-guitar.com, chordify...).
   - Giai dieu: trang ghi not theo tung chu cua loi (vd noobnotes.net, letter notes), ky hieu ABC (abcnotation.com), hoac sheet dang chu.
   - Doc it nhat 1 nguon cho hop am va co gang 1 nguon cho giai dieu. Toi da khoang 6 lan tim/doc.
   - Neu nguon ghi theo giong khac voi giong goc, giu nguyen giong cua nguon va ghi vao key.
2) Neu khong co nguon giai dieu, moi dung tri nho cua ban, va khi do confidence toi da la trung binh.
3) Pho lai thanh du lieu:
- melody: giai dieu phan hat, MOI NOT UNG VOI MOT AM TIET LOI (am tiet luyen nhieu not thi chi lay not chinh), chia theo cau hat. Dang mang cac cau, moi cau la mang ten not kieu C4, D#4, Bb3. Pho doan dau (verse) va diep khuc, khoang 40-150 not.
- chords: chuoi hop am theo thu tu cung doan nhac do, moi phan tu la MOT lan gay/nhan (khoang 1-2 lan moi o nhip). Dung ten hop am pho thong: C, Am, G7, F#m, Bb, Cmaj7...
- KHONG chep loi bai hat vao ket qua.
- Phan nao co nguon/chac chan thi tra phan do: co hop am ma khong co giai dieu -> van found=true, melody=[] va TRA DAY DU chords. Khong bia not.
- Chi dat found=false khi bai khong ton tai hoac khong co ca hop am lan giai dieu; giai thich ngan trong note bang tieng Viet.
- confidence: cao / trung binh / thap = muc chac chan ve do chinh xac giai dieu.
- sources: danh sach URL da dung; melody_from: nguon hoac tri nho; chords_from: nguon hoac tri nho.
- note: 1-2 cau tieng Viet noi da lay tu dau.

Ket thuc bang dung MOT doi tuong JSON, khong markdown, khong giai thich them. Mau:
{{"found": true, "title": "...", "artist": "...", "key": "C", "confidence": "trung binh", "note": "...", "melody_from": "nguon", "chords_from": "nguon", "sources": ["https://..."], "melody": [["E4","D4","C4"],["G4","G4"]], "chords": ["C","G","Am","F"]}}
"""


def slugify(s):
    s = s.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "bai-hat"


def clean_input(s):
    # bo ky tu co the pha lenh / prompt
    return re.sub(r'[\"<>|&^%`\r\n]', " ", s or "").strip()[:120]


def ask_claude(title, artist):
    exe = find_claude()
    if not exe:
        raise RuntimeError("Không tìm thấy Claude Code (claude.exe) trên máy.")
    prompt = PROMPT.format(title=title, artist=artist or "khong ro")
    cmd = [exe, "--allowedTools", "WebSearch,WebFetch", "-p", prompt]
    if exe.lower().endswith(".cmd"):
        cmd = ["cmd", "/c"] + cmd
    # chay o thu muc tam de khong nap CLAUDE.md cua workspace
    r = subprocess.run(cmd, cwd=tempfile.gettempdir(), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    out = (r.stdout or "").strip()
    i, j = out.find("{"), out.rfind("}")
    if i < 0 or j < 0:
        raise RuntimeError("AI không trả về dữ liệu hợp lệ. " + (out or r.stderr or "")[:300])
    return json.loads(out[i:j + 1])


def validate(d):
    melody = []
    for ph in d.get("melody") or []:
        if isinstance(ph, list):
            notes = [str(n).strip() for n in ph if NOTE_RE.match(str(n).strip())]
            if notes:
                melody.append(notes)
    chords = [str(c).strip() for c in d.get("chords") or [] if CHORD_RE.match(str(c).strip())]
    return melody, chords


def list_songs():
    items = []
    for p in sorted(glob.glob(os.path.join(SONGS, "*.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                items.append(json.load(f))
        except Exception:
            pass
    items.sort(key=lambda s: s.get("created", 0))
    return items


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/songs"):
            return self.send_json(list_songs())
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/songs":
            return self.send_json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            title, artist = clean_input(req.get("title")), clean_input(req.get("artist"))
            if not title:
                return self.send_json({"error": "Chưa nhập tên bài hát."}, 400)
            d = ask_claude(title, artist)
            if not d.get("found"):
                return self.send_json({"found": False, "note": d.get("note") or "AI không tìm được bài này."})
            melody, chords = validate(d)
            if not melody and not chords:
                return self.send_json({"found": False, "note": "AI trả về bản phổ rỗng hoặc sai định dạng. Thử lại sau."})
            sid = slugify(f"{d.get('title') or title}-{d.get('artist') or artist}")
            song = {
                "id": sid,
                "title": d.get("title") or title,
                "artist": d.get("artist") or artist,
                "key": d.get("key", ""),
                "confidence": d.get("confidence", ""),
                "note": d.get("note", ""),
                "source": "AI",
                "melody_from": d.get("melody_from", ""),
                "chords_from": d.get("chords_from", ""),
                "sources": [u for u in d.get("sources") or [] if str(u).startswith("http")][:6],
                "created": time.time(),
                "melody": melody,
                "chords": chords,
            }
            with open(os.path.join(SONGS, sid + ".json"), "w", encoding="utf-8") as f:
                json.dump(song, f, ensure_ascii=False, indent=1)
            return self.send_json({"found": True, "song": song})
        except subprocess.TimeoutExpired:
            return self.send_json({"error": "AI xử lý quá lâu (quá 10 phút). Thử lại."}, 504)
        except Exception as e:
            return self.send_json({"error": str(e)}, 500)

    def do_DELETE(self):
        m = re.match(r"^/api/songs/([a-z0-9-]+)$", self.path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        p = os.path.join(SONGS, m.group(1) + ".json")
        if os.path.exists(p):
            os.remove(p)
        return self.send_json({"ok": True})


if __name__ == "__main__":
    import sys
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    os.makedirs(SONGS, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"Instrument đang chạy tại {url}  (Ctrl+C để tắt)")
    print("Claude Code:", find_claude() or "KHÔNG TÌM THẤY - chức năng thêm bài sẽ không chạy")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
