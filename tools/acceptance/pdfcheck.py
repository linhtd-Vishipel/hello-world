"""Kiểm tra file PDF chỉ bằng thư viện chuẩn của Python — không cần Poppler, pypdf hay PyMuPDF.

Đủ cho PDF do Web App tạo (reportlab) và PDF do LibreOffice xuất:
  * cấu trúc: header %PDF-, %%EOF, bảng xref/startxref, các object đọc được;
  * cây trang, số trang, khổ giấy (MediaBox);
  * font: tên, có nhúng hay không (FontFile/FontFile2/FontFile3);
  * nội dung: trích chữ theo bảng ToUnicode (tiếng Việt), vị trí và độ rộng từng đoạn chữ
    (để phát hiện chữ tràn lề), ảnh trên từng trang (để phát hiện trang trắng).

Hỗ trợ: FlateDecode, ASCII85Decode, ASCIIHexDecode; font đơn byte (TrueType/Type1) và Type0
(2 byte, Identity-H); object stream (/ObjStm); Form XObject lồng nhau.
Không hỗ trợ (báo lỗi rõ thay vì trả kết quả sai): mã hoá/mật khẩu, bộ lọc khác (LZW, DCT cho nội dung).
"""
import base64
import re
import zlib
from pathlib import Path


class PdfError(Exception):
    """PDF không đọc được hoặc dùng tính năng ngoài phạm vi hỗ trợ."""


# ---------------------------------------------------------------------------
# Bộ đọc object PDF tối giản
# ---------------------------------------------------------------------------

class Ref(tuple):
    __slots__ = ()


class Name(str):
    __slots__ = ()


_WS = b" \t\r\n\f\x00"
_DELIM = b"()<>[]{}/%"


def _lexer(data, pos=0):
    n = len(data)
    while pos < n:
        c = data[pos:pos + 1]
        if c in (b" ", b"\t", b"\r", b"\n", b"\f", b"\x00"):
            pos += 1
        elif c == b"%":
            while pos < n and data[pos:pos + 1] not in (b"\r", b"\n"):
                pos += 1
        elif c == b"/":
            end = pos + 1
            while end < n and data[end:end + 1] not in _WS and data[end:end + 1] not in _DELIM:
                end += 1
            raw = data[pos + 1:end]
            yield "name", Name(re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), raw).decode("latin-1")), end
            pos = end
        elif c == b"(":
            depth, i, out = 1, pos + 1, bytearray()
            while i < n and depth:
                ch = data[i]
                if ch == 0x5C:  # backslash
                    i += 1
                    e = data[i:i + 1]
                    esc = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}
                    if e in esc:
                        out += esc[e]
                        i += 1
                    elif e in (b"\r", b"\n"):
                        i += 2 if data[i:i + 2] == b"\r\n" else 1
                    elif e and e in b"01234567":
                        j = i
                        while j < i + 3 and data[j:j + 1] and data[j:j + 1] in b"01234567":
                            j += 1
                        out.append(int(data[i:j], 8) & 0xFF)
                        i = j
                    else:
                        i += 1
                    continue
                if ch == 0x28:
                    depth += 1
                elif ch == 0x29:
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                out.append(ch)
                i += 1
            yield "str", bytes(out), i
            pos = i
        elif c == b"<" and data[pos + 1:pos + 2] == b"<":
            yield "<<", None, pos + 2
            pos += 2
        elif c == b">" and data[pos + 1:pos + 2] == b">":
            yield ">>", None, pos + 2
            pos += 2
        elif c == b"<":
            end = data.index(b">", pos)
            hx = re.sub(rb"\s", b"", data[pos + 1:end])
            if len(hx) % 2:
                hx += b"0"
            yield "str", bytes.fromhex(hx.decode("ascii")), end + 1
            pos = end + 1
        elif c in (b"[", b"]", b"{", b"}"):
            yield c.decode(), None, pos + 1
            pos += 1
        else:
            end = pos
            while end < n and data[end:end + 1] not in _WS and data[end:end + 1] not in _DELIM:
                end += 1
            if end == pos:
                end += 1
            tok = data[pos:end]
            try:
                yield "num", (float(tok) if (b"." in tok) else int(tok)), end
            except ValueError:
                yield "op", tok.decode("latin-1"), end
            pos = end


def _parse_object(tokens):
    kind, val, _ = next(tokens)
    return _build(kind, val, tokens)


def _build(kind, val, tokens):
    if kind == "<<":
        d = {}
        while True:
            k, v, _ = next(tokens)
            if k == ">>":
                return d
            if k != "name":
                raise PdfError("dictionary key is not a name")
            k2, v2, _ = next(tokens)
            d[v] = _build(k2, v2, tokens)
    if kind == "[":
        arr = []
        while True:
            k, v, _ = next(tokens)
            if k == "]":
                return _fold_refs(arr)
            arr.append(_build(k, v, tokens))
    if kind == "op":
        return {"true": True, "false": False, "null": None, "R": "__R__"}.get(val, val)
    return val


def _fold_refs(arr):
    out = []
    for x in arr:
        if x == "__R__" and len(out) >= 2 and isinstance(out[-1], int) and isinstance(out[-2], int):
            g, num = out.pop(), out.pop()
            out.append(Ref((num, g)))
        else:
            out.append(x)
    return out


def _parse_dict_at(data, pos):
    """Parse one object (with 'n g R' references) starting at pos; returns (value, end_pos)."""
    toks = _lexer(data, pos)
    buf = []
    depth = 0
    end = pos
    for kind, val, end in toks:
        buf.append((kind, val))
        if kind in ("<<", "["):
            depth += 1
        elif kind in (">>", "]"):
            depth -= 1
        if depth == 0:
            break
    # resolve "n g R" inside dicts: re-run with a ref-aware builder
    it = iter(buf)

    def build(kind, val):
        if kind == "<<":
            pending = []
            while True:
                k, v = next(it)
                if k == ">>":
                    return _fold_dict(pending)
                pending.append(build(k, v) if k in ("<<", "[") else (v if k != "op" else {"R": "__R__", "true": True,
                                                                                               "false": False, "null": None}.get(v, v)))
        if kind == "[":
            arr = []
            while True:
                k, v = next(it)
                if k == "]":
                    return _fold_refs(arr)
                arr.append(build(k, v) if k in ("<<", "[") else (v if k != "op" else {"R": "__R__", "true": True,
                                                                                         "false": False, "null": None}.get(v, v)))
        if kind == "op":
            return {"true": True, "false": False, "null": None}.get(val, val)
        return val

    first = next(it)
    return build(*first), end


def _fold_dict(items):
    items = _fold_refs(items)
    d = {}
    i = 0
    while i < len(items):
        k = items[i]
        if not isinstance(k, Name):
            raise PdfError("dictionary key is not a name")
        d[str(k)] = items[i + 1] if i + 1 < len(items) else None
        i += 2
    return d


# ---------------------------------------------------------------------------
# Bộ lọc stream
# ---------------------------------------------------------------------------

def _apply_filters(d, raw):
    filters = d.get("Filter")
    if filters is None:
        return raw
    filters = filters if isinstance(filters, list) else [filters]
    for f in filters:
        if f == "FlateDecode":
            raw = zlib.decompress(raw)
        elif f == "ASCII85Decode":
            raw = raw.strip()
            if not raw.endswith(b"~>"):
                raw += b"~>"
            raw = base64.a85decode(raw, adobe=True)
        elif f == "ASCIIHexDecode":
            raw = bytes.fromhex(re.sub(rb"[^0-9A-Fa-f]", b"", raw.split(b">")[0]).decode())
        elif f == "DCTDecode":
            return None  # ảnh JPEG: không cần giải mã để kiểm tra
        else:
            raise PdfError(f"bộ lọc {f} chưa được hỗ trợ")
    return raw


# ---------------------------------------------------------------------------
# Ma trận
# ---------------------------------------------------------------------------

def _mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)


def _apply(m, x, y):
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


# ---------------------------------------------------------------------------
# Font
# ---------------------------------------------------------------------------

class Font:
    def __init__(self, pdf, d):
        self.name = str(d.get("BaseFont", "?"))
        self.subtype = str(d.get("Subtype", "?"))
        self.two_byte = self.subtype == "Type0"
        desc = None
        self.widths, self.first, self.default_w, self.cid_w = {}, 0, 0.0, {}
        if self.two_byte:
            desc_font = pdf.resolve((pdf.resolve(d.get("DescendantFonts")) or [None])[0]) or {}
            desc = pdf.resolve(desc_font.get("FontDescriptor"))
            self.default_w = float(desc_font.get("DW", 1000))
            w = pdf.resolve(desc_font.get("W")) or []
            i = 0
            while i < len(w):
                start = int(pdf.resolve(w[i]))
                nxt = pdf.resolve(w[i + 1])
                if isinstance(nxt, list):
                    for k, val in enumerate(nxt):
                        self.cid_w[start + k] = float(pdf.resolve(val))
                    i += 2
                else:
                    for cid in range(start, int(nxt) + 1):
                        self.cid_w[cid] = float(pdf.resolve(w[i + 2]))
                    i += 3
        else:
            desc = pdf.resolve(d.get("FontDescriptor"))
            self.first = int(pdf.resolve(d.get("FirstChar", 0)) or 0)
            ws = pdf.resolve(d.get("Widths")) or []
            self.widths = {self.first + i: float(pdf.resolve(w)) for i, w in enumerate(ws)}
            if desc:
                self.default_w = float(pdf.resolve(desc.get("MissingWidth", 0)) or 0)
        desc = desc or {}
        self.embedded = any(k in desc for k in ("FontFile", "FontFile2", "FontFile3"))
        self.tounicode = {}
        tu = d.get("ToUnicode")
        if tu is not None:
            self.tounicode = _parse_cmap(pdf.stream(tu))

    def decode(self, s):
        """bytes -> list of (unicode_text, width_in_text_space_units/1000)"""
        out = []
        step = 2 if self.two_byte else 1
        for i in range(0, len(s) - step + 1, step):
            code = int.from_bytes(s[i:i + step], "big")
            text = self.tounicode.get(code)
            if text is None:
                text = chr(code) if not self.two_byte else "�"
            w = self.cid_w.get(code, self.default_w) if self.two_byte else self.widths.get(code, self.default_w)
            out.append((text, w, code == 32 or text == " "))
        return out


def _parse_cmap(data):
    m = {}
    if not data:
        return m
    text = data.decode("latin-1")

    def u16(h):
        b = bytes.fromhex(h)
        try:
            return b.decode("utf-16-be")
        except UnicodeDecodeError:
            return ""

    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            m[int(src, 16)] = u16(dst)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, rest in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)", block):
            lo, hi = int(lo, 16), int(hi, 16)
            if rest.startswith("["):
                for k, h in enumerate(re.findall(r"<([0-9A-Fa-f]+)>", rest)):
                    m[lo + k] = u16(h)
            else:
                base = bytes.fromhex(rest[1:-1])
                for k in range(hi - lo + 1):
                    v = int.from_bytes(base, "big") + k
                    try:
                        m[lo + k] = v.to_bytes(len(base), "big").decode("utf-16-be")
                    except UnicodeDecodeError:
                        m[lo + k] = ""
    return m


# ---------------------------------------------------------------------------
# Tài liệu
# ---------------------------------------------------------------------------

class Run:
    """Một đoạn chữ đã vẽ: toạ độ thiết bị (gốc ở góc dưới trái trang)."""
    __slots__ = ("x0", "x1", "y", "size", "text")

    def __init__(self, x0, x1, y, size, text):
        self.x0, self.x1, self.y, self.size, self.text = x0, x1, y, size, text


class Page:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.runs, self.images = [], 0

    def lines(self, tol=2.5):
        """Chữ gom theo dòng (trên xuống dưới, trái sang phải)."""
        runs = sorted((r for r in self.runs if r.text.strip()), key=lambda r: (-r.y, r.x0))
        lines, cur, cur_y = [], [], None
        for r in runs:
            if cur and abs(r.y - cur_y) > tol:
                lines.append(cur)
                cur = []
            if not cur:
                cur_y = r.y
            cur.append(r)
        if cur:
            lines.append(cur)
        out = []
        for ln in lines:
            ln.sort(key=lambda r: r.x0)
            text, last = "", None
            for r in ln:
                # word break when the gap exceeds 0.1 em (same rule as Poppler's pdftotext)
                if last is not None and r.x0 - last.x1 > 0.1 * max(r.size, 1) and not text.endswith(" "):
                    text += " "
                text += r.text
                last = r
            out.append(text.strip())
        return out


class Pdf:
    def __init__(self, path):
        self.path = Path(path)
        self.data = data = self.path.read_bytes()
        self.size = len(data)
        self.header_ok = data.startswith(b"%PDF-")
        self.version = data[5:8].decode("latin-1", "replace") if self.header_ok else ""
        self.eof_ok = b"%%EOF" in data[-2048:]
        self.xref_ok = b"startxref" in data[-2048:]
        if b"/Encrypt" in data:
            raise PdfError("PDF được mã hoá/mật khẩu — không kiểm tra được")
        self.objects = {}
        self._offsets = {}
        for m in re.finditer(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b", data):
            self._offsets[int(m.group(1))] = m.end()
        for num in list(self._offsets):
            self._load(num)
        for num, obj in list(self.objects.items()):
            if isinstance(obj, tuple) and isinstance(obj[0], dict) and obj[0].get("Type") == "ObjStm":
                self._expand_objstm(obj)
        trailer_root = None
        for m in re.finditer(rb"trailer\s*<<", data):
            t, _ = _parse_dict_at(data, m.start() + len(b"trailer"))
            trailer_root = t.get("Root", trailer_root)
        if trailer_root is None:  # xref stream
            for obj in self.objects.values():
                if isinstance(obj, tuple) and isinstance(obj[0], dict) and obj[0].get("Type") == "XRef":
                    trailer_root = obj[0].get("Root")
        if trailer_root is None:
            for obj in self.objects.values():
                d = obj[0] if isinstance(obj, tuple) else obj
                if isinstance(d, dict) and d.get("Type") == "Catalog":
                    trailer_root = d
        if trailer_root is None:
            raise PdfError("không tìm thấy Catalog (/Root)")
        self.catalog = self.resolve(trailer_root)
        self._fonts = {}
        self.pages = []
        self._walk(self.resolve(self.catalog["Pages"]), {}, None)

    # -- object access -----------------------------------------------------
    def _load(self, num):
        pos = self._offsets[num]
        val, end = _parse_dict_at(self.data, pos)
        rest = self.data[end:end + 20]
        m = re.match(rb"\s*stream(\r\n|\n|\r)?", rest)
        if isinstance(val, dict) and m:
            start = end + m.end()
            length = val.get("Length")
            if isinstance(length, Ref):
                lp = self._offsets.get(length[0])
                length = _parse_dict_at(self.data, lp)[0] if lp is not None else None
            if not isinstance(length, int):
                length = self.data.index(b"endstream", start) - start
            self.objects[num] = (val, self.data[start:start + length])
        else:
            self.objects[num] = val

    def _expand_objstm(self, obj):
        d, raw = obj
        body = _apply_filters(d, raw)
        n, first = int(d["N"]), int(d["First"])
        header = body[:first].split()
        for i in range(n):
            num, off = int(header[2 * i]), int(header[2 * i + 1])
            if num not in self.objects:
                self.objects[num] = _parse_dict_at(body, first + off)[0]

    def resolve(self, v):
        seen = 0
        while isinstance(v, Ref) and seen < 50:
            o = self.objects.get(v[0])
            v = o[0] if isinstance(o, tuple) else o
            seen += 1
        return v

    def stream(self, ref):
        o = self.objects.get(ref[0]) if isinstance(ref, Ref) else None
        if not isinstance(o, tuple):
            return b""
        return _apply_filters(o[0], o[1]) or b""

    def font(self, ref):
        key = ref[0] if isinstance(ref, Ref) else id(ref)
        if key not in self._fonts:
            self._fonts[key] = Font(self, self.resolve(ref))
        return self._fonts[key]

    # -- pages ----------------------------------------------------------------
    def _walk(self, node, inherited, parent_box):
        res = node.get("Resources", inherited.get("Resources"))
        box = node.get("MediaBox", parent_box)
        if node.get("Type") == "Pages" or "Kids" in node:
            for kid in self.resolve(node.get("Kids")) or []:
                self._walk(self.resolve(kid), {"Resources": res}, box)
            return
        box = [float(self.resolve(x)) for x in self.resolve(box)]
        page = Page(box[2] - box[0], box[3] - box[1])
        contents = node.get("Contents")
        contents = self.resolve(contents) if not isinstance(contents, Ref) else contents
        parts = contents if isinstance(contents, list) else [contents]
        data = b"\n".join(self.stream(c) for c in parts if c is not None)
        self._run(data, self.resolve(res) or {}, page, IDENT, 0)
        self.pages.append(page)

    def all_fonts(self):
        return list(self._fonts.values())

    # -- content stream interpreter ------------------------------------------
    def _run(self, data, resources, page, ctm, depth):
        fonts = self.resolve(resources.get("Font")) or {}
        xobjs = self.resolve(resources.get("XObject")) or {}
        stack, gs = [], []
        tm = tlm = IDENT
        font, size, leading, tc, tw, tz = None, 1.0, 0.0, 0.0, 0.0, 1.0
        it = _lexer(data)
        for kind, val, _ in it:
            if kind != "op":
                if kind in ("<<", "["):
                    stack.append(_build(kind, val, ((k, v, e) for k, v, e in it)))
                else:
                    stack.append(val)
                continue
            op = val
            if op == "q":
                gs.append(ctm)
            elif op == "Q":
                ctm = gs.pop() if gs else ctm
            elif op == "cm" and len(stack) >= 6:
                ctm = _mul(tuple(float(x) for x in stack[-6:]), ctm)
            elif op == "BT":
                tm = tlm = IDENT
            elif op == "Tf" and len(stack) >= 2:
                font = self.font(fonts.get(str(stack[-2]))) if fonts.get(str(stack[-2])) is not None else None
                size = float(stack[-1])
            elif op == "TL" and stack:
                leading = float(stack[-1])
            elif op == "Tc" and stack:
                tc = float(stack[-1])
            elif op == "Tw" and stack:
                tw = float(stack[-1])
            elif op == "Tz" and stack:
                tz = float(stack[-1]) / 100
            elif op == "Tm" and len(stack) >= 6:
                tm = tlm = tuple(float(x) for x in stack[-6:])
            elif op in ("Td", "TD") and len(stack) >= 2:
                tx, ty = float(stack[-2]), float(stack[-1])
                if op == "TD":
                    leading = -ty
                tm = tlm = _mul((1, 0, 0, 1, tx, ty), tlm)
            elif op == "T*":
                tm = tlm = _mul((1, 0, 0, 1, 0, -leading), tlm)
            elif op in ("Tj", "'", '"', "TJ") and stack:
                if op in ("'", '"'):
                    tm = tlm = _mul((1, 0, 0, 1, 0, -leading), tlm)
                items = stack[-1] if op == "TJ" else [stack[-1]]
                for item in items if isinstance(items, list) else [items]:
                    if isinstance(item, (int, float)):
                        tm = _mul((1, 0, 0, 1, -float(item) / 1000 * size * tz, 0), tm)
                        continue
                    if not isinstance(item, bytes) or font is None:
                        continue
                    trm = _mul(tm, ctm)
                    x0, y0 = _apply(trm, 0, 0)
                    text, adv = "", 0.0
                    for ch, w, is_space in font.decode(item):
                        text += ch
                        adv += (w / 1000 * size + tc + (tw if is_space else 0)) * tz
                    x1, _ = _apply(_mul((1, 0, 0, 1, adv, 0), trm), 0, 0)
                    page.runs.append(Run(min(x0, x1), max(x0, x1), y0, size * (abs(trm[3]) or 1), text))
                    tm = _mul((1, 0, 0, 1, adv, 0), tm)
            elif op == "Do" and stack:
                ref = xobjs.get(str(stack[-1]))
                x = self.objects.get(ref[0]) if isinstance(ref, Ref) else None
                xd = x[0] if isinstance(x, tuple) else {}
                if xd.get("Subtype") == "Image":
                    page.images += 1
                elif xd.get("Subtype") == "Form" and depth < 10:
                    mat = tuple(float(v) for v in (xd.get("Matrix") or IDENT))
                    self._run(self.stream(ref), self.resolve(xd.get("Resources")) or resources, page, _mul(mat, ctm), depth + 1)
            stack = []


def open_pdf(path):
    return Pdf(path)


def text(path_or_pdf):
    """Toàn văn: các dòng nối bằng \\n, các trang ngăn cách bằng \\f (giống pdftotext)."""
    pdf = path_or_pdf if isinstance(path_or_pdf, Pdf) else Pdf(path_or_pdf)
    return "\f".join("\n".join(p.lines()) for p in pdf.pages)
