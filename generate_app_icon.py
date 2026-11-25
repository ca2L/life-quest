# -*- coding: utf-8 -*-
"""生成小程序头像：玩到120岁
游戏手柄造型 + 文字，配色沿用小程序主色调（紫 #6f5ce8 / 深紫 #4a37b0，金色点缀）。
输出 144x144（提交用）与 512x512（高清备用），均为 PNG。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
os.makedirs(OUT_DIR, exist_ok=True)

HI = 576      # 4 倍超采样，降采样后边缘平滑
TARGET = 144
FONT_BOLD = "/c/Windows/Fonts/msyhbd.ttc"

DEEP_PURPLE = (74, 55, 176)  # #4a37b0 深紫
GOLD = (255, 209, 102)       # #ffd166 点缀金
WHITE = (255, 255, 255)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)


# 1. 渐变背景 ---------------------------------------------------------------
yy, xx = np.mgrid[0:HI, 0:HI]
t = np.clip((xx * 0.5 + yy * 0.5) / HI, 0, 1)
bg = hexrgb("7C6CF0")[None, None, :] * (1 - t[..., None]) + hexrgb("37277E")[None, None, :] * t[..., None]
dist = np.sqrt(((xx - HI * 0.3) / (HI * 0.9)) ** 2 + ((yy - HI * 0.1) / (HI * 0.6)) ** 2)
bg = bg + (np.clip(1 - dist, 0, 1) ** 1.6 * 40)[..., None]
bg_img = Image.fromarray(np.clip(bg, 0, 255).astype("uint8"), "RGB").convert("RGBA")

mask = Image.new("L", (HI, HI), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, HI - 1, HI - 1], radius=int(HI * 0.225), fill=255)
base = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
base.paste(bg_img, (0, 0), mask)

# 2. 游戏手柄 ---------------------------------------------------------------
gcx, gcy = HI / 2, HI * 0.42          # 手柄中心（上半区，给下方文字留空间）
body_w, body_h = HI * 0.60, HI * 0.245
left, right = gcx - body_w / 2, gcx + body_w / 2
top, bot = gcy - body_h / 2, gcy + body_h / 2

gamepad = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
gd = ImageDraw.Draw(gamepad)

# 握把（两侧向下延伸的椭圆）
grip_w, grip_h = HI * 0.15, HI * 0.19
for gx in (left + grip_w * 0.42, right - grip_w * 0.42):
    gd.ellipse([gx - grip_w / 2, gcy + body_h * 0.02,
                gx + grip_w / 2, gcy + body_h * 0.02 + grip_h], fill=WHITE + (255,))
# 主机身（圆角矩形）
gd.rounded_rectangle([left, top, right, bot], radius=int(HI * 0.075), fill=WHITE + (255,))

# 手柄柔光
pad_shadow = gamepad.filter(ImageFilter.GaussianBlur(HI * 0.018))
pad_shadow.putalpha(pad_shadow.getchannel("A").point(lambda a: int(a * 0.45)))
base = Image.alpha_composite(base, pad_shadow)
base = Image.alpha_composite(base, gamepad)
gd = ImageDraw.Draw(base)

# 十字方向键（左，主色紫）
dpad_cx, dpad_cy = left + body_w * 0.21, gcy - HI * 0.005
arm_l, arm_t = HI * 0.060, HI * 0.021
gd.rounded_rectangle([dpad_cx - arm_l, dpad_cy - arm_t,
                      dpad_cx + arm_l, dpad_cy + arm_t], radius=int(arm_t), fill=DEEP_PURPLE + (255,))
gd.rounded_rectangle([dpad_cx - arm_t, dpad_cy - arm_l,
                      dpad_cx + arm_t, dpad_cy + arm_l], radius=int(arm_t), fill=DEEP_PURPLE + (255,))

# 四个按钮（右，金色）
btn_r = HI * 0.017
bx, by = right - body_w * 0.21, gcy - HI * 0.005
step = HI * 0.043
for ox, oy in ((0, -step), (0, step), (-step, 0), (step, 0)):
    cx, cy = bx + ox, by + oy
    gd.ellipse([cx - btn_r, cy - btn_r, cx + btn_r, cy + btn_r], fill=GOLD + (255,))

# 中间凹槽（手柄质感）
mid_cx = gcx
gd.rounded_rectangle([mid_cx - HI * 0.020, gcy - HI * 0.028,
                      mid_cx + HI * 0.020, gcy + HI * 0.028],
                     radius=int(HI * 0.010), outline=(214, 208, 240, 255), width=max(2, int(HI * 0.006)))

# 3. 文字 -------------------------------------------------------------------
def draw_centered_text(draw, text, cy, size, fill, font_path=FONT_BOLD, stroke=0, stroke_fill=None):
    font = ImageFont.truetype(font_path, size)
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (HI - tw) / 2 - box[0]
    y = cy - th / 2 - box[1]
    draw.text((x, y), text, font=font, fill=fill,
              stroke_width=stroke, stroke_fill=stroke_fill or (0, 0, 0, 0))

# 主文字：玩到120岁
draw_centered_text(ImageDraw.Draw(base), "玩到120岁", HI * 0.755,
                   int(HI * 0.118), WHITE + (255,), stroke=int(HI * 0.004),
                   stroke_fill=DEEP_PURPLE + (120,))
# 副标题：LIFE QUEST
draw_centered_text(ImageDraw.Draw(base), "LIFE QUEST", HI * 0.872,
                   int(HI * 0.042), GOLD + (230,))

# 4. 输出 -------------------------------------------------------------------
base_rgb = base.convert("RGB")
for size, name in ((TARGET, "life-quest-icon-144.png"), (512, "life-quest-icon-512.png")):
    path = os.path.join(OUT_DIR, name)
    base_rgb.resize((size, size), Image.LANCZOS).save(path, "PNG", optimize=True)
    print("saved:", path, os.path.getsize(path), "bytes")
