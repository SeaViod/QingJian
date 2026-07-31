#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成青简图标 icon.ico（手写 PNG/ICO 容器，无第三方依赖）

图案：朱砂圆角印 + 宣纸白内框 + 中央书脊线
"""
import os
import struct
import zlib

SIZE = 256
CINNABAR = (0xB4, 0x44, 0x2E)   # 朱砂
PAPER = (0xF4, 0xF1, 0xE8)      # 宣纸白


def in_rrect(x, y, x0, y0, x1, y1, r):
    """点是否在圆角矩形内（近似：中心矩形 + 四角圆弧）"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def build_pixels():
    pixels = bytearray()
    for y in range(SIZE):
        for x in range(SIZE):
            base = in_rrect(x, y, 0, 0, SIZE - 1, SIZE - 1, 44)          # 朱砂底
            ring = base and not in_rrect(x, y, 46, 46, SIZE - 47, SIZE - 47, 30)  # 白内框
            spine = in_rrect(x, y, SIZE // 2 - 6, 54, SIZE // 2 + 6, SIZE - 55, 6)  # 书脊线
            if ring or spine:
                c = PAPER
            elif base:
                c = CINNABAR
            else:
                pixels += bytes((0, 0, 0, 0))
                continue
            pixels += bytes((*c, 255))
    return bytes(pixels)


def main():
    pixels = build_pixels()
    raw = b"".join(b"\x00" + pixels[y * SIZE * 4:(y + 1) * SIZE * 4] for y in range(SIZE))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))

    ico = struct.pack("<HHH", 0, 1, 1)
    ico += struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
    ico += png

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
    with open(out, "wb") as f:
        f.write(ico)
    print(f"icon.ico written: {len(ico)} bytes -> {out}")


if __name__ == "__main__":
    main()
